"""Weekly backup runner: SSH into the server, run the backup shell scripts,
then download the newest file from each backup output folder."""

import fnmatch
import json
import posixpath
import sys
from datetime import datetime
from pathlib import Path

import paramiko

BASE_DIR = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
LOG_DIR = BASE_DIR / "logs"
SSH_CONFIG_PATH = Path.home() / ".ssh" / "config"


def resolve_ssh_target(alias: str) -> dict:
    """Look up host/user/key for `alias` in ~/.ssh/config (same alias used for `ssh <alias>`)."""
    if not SSH_CONFIG_PATH.exists():
        sys.exit(f"~/.ssh/config not found at {SSH_CONFIG_PATH}")

    ssh_config = paramiko.SSHConfig()
    with open(SSH_CONFIG_PATH, encoding="utf-8") as f:
        ssh_config.parse(f)

    host_cfg = ssh_config.lookup(alias)
    if "hostname" not in host_cfg:
        sys.exit(f"No 'Host {alias}' entry found in {SSH_CONFIG_PATH}")

    return {
        "hostname": host_cfg["hostname"],
        "port": int(host_cfg.get("port", 22)),
        "username": host_cfg.get("user"),
        "key_path": host_cfg["identityfile"][0] if host_cfg.get("identityfile") else None,
    }


def log(msg: str, logfile) -> None:
    line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line)
    logfile.write(line + "\n")
    logfile.flush()


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        sys.exit(f"Config not found: {CONFIG_PATH}. Copy config.example.json to config.json and fill it in.")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def run_remote_scripts(ssh: paramiko.SSHClient, cfg: dict, logfile) -> None:
    remote_dir = cfg["remote_script_dir"]
    parts = " && ".join(f"./{s}" for s in cfg["scripts"])
    cmd = f"cd {remote_dir} && {parts}"
    log(f"Running remote command: {cmd}", logfile)

    stdin, stdout, stderr = ssh.exec_command(cmd)
    for line in stdout:
        log(f"[remote] {line.rstrip()}", logfile)
    err_output = stderr.read().decode(errors="replace")
    exit_status = stdout.channel.recv_exit_status()

    if err_output.strip():
        log(f"[remote-stderr] {err_output.strip()}", logfile)

    if exit_status != 0:
        raise RuntimeError(f"Remote backup scripts failed with exit code {exit_status}")

    log("Remote backup scripts finished successfully.", logfile)


def resolve_remote_dir(sftp: paramiko.SFTPClient, remote_dir: str) -> str:
    if remote_dir.startswith("~"):
        home = sftp.normalize(".")
        remote_dir = remote_dir.replace("~", home, 1)
    return remote_dir


def newest_matching_file(sftp: paramiko.SFTPClient, remote_dir: str, pattern: str):
    entries = [e for e in sftp.listdir_attr(remote_dir) if fnmatch.fnmatch(e.filename, pattern)]
    if not entries:
        return None
    return max(entries, key=lambda e: e.st_mtime)


def download_latest_backups(ssh: paramiko.SSHClient, cfg: dict, logfile) -> Path:
    sftp = ssh.open_sftp()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    local_dir = (BASE_DIR / cfg["local_backup_dir"] / stamp).resolve()
    local_dir.mkdir(parents=True, exist_ok=True)

    for target in cfg["downloads"]:
        remote_dir = resolve_remote_dir(sftp, target["remote_dir"])
        entry = newest_matching_file(sftp, remote_dir, target["pattern"])
        if entry is None:
            log(f"No file matching '{target['pattern']}' found in {remote_dir}", logfile)
            continue

        remote_path = posixpath.join(remote_dir, entry.filename)
        local_path = local_dir / entry.filename
        log(f"Downloading {remote_path} -> {local_path}", logfile)
        sftp.get(remote_path, str(local_path))

    sftp.close()
    return local_dir


def main() -> int:
    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"backup-{datetime.now():%Y%m%d-%H%M%S}.log"

    with open(log_path, "w", encoding="utf-8") as logfile:
        try:
            cfg = load_config()
            target = resolve_ssh_target(cfg["ssh_alias"])
            log(f"Connecting to {target['username']}@{target['hostname']}:{target['port']} "
                f"(alias '{cfg['ssh_alias']}')", logfile)

            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                hostname=target["hostname"],
                port=target["port"],
                username=target["username"],
                key_filename=target["key_path"],
                timeout=30,
            )

            run_remote_scripts(ssh, cfg, logfile)
            local_dir = download_latest_backups(ssh, cfg, logfile)
            ssh.close()

            log(f"Backup complete. Files saved to {local_dir}", logfile)
            return 0
        except Exception as exc:
            log(f"BACKUP FAILED: {exc}", logfile)
            return 1


if __name__ == "__main__":
    sys.exit(main())
