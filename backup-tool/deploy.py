"""One-click deploy: backup first, then replace /var/www/gembel.store with a fresh clone.

Same thing as doing it by hand on the VPS:
    cd /var/www && sudo rm -rf gembel.store && sudo git clone https://github.com/blackwanz/gembel.store.git
but safe:
  1. full backup (same as backup.py: bksource.sh + dumpdb.sh, newest files downloaded here)
  2. clone into /var/www/gembel.store.new-<stamp> -- the live site isn't touched yet, so a failed
     clone changes nothing
  3. live folder is renamed to gembel.store.backup-<stamp> (same naming as the old manual
     backups), the new clone takes its place; if that swap fails the old folder is moved back
  4. files listed in carry_over are copied from the old folder (none by default -- see DEFAULTS)

    python deploy.py          # do it
    python deploy.py --dry    # only connect & show what would happen, change nothing
    python deploy.py --skip-backup

Reuses config.json (ssh_alias etc.) and the backup steps from backup.py. Optional config keys:
repo_url, branch, www_dir, site_dir, carry_over (list of paths relative to the site folder).
"""

import getpass
import shlex
import sys
import time
from datetime import datetime

import paramiko

import backup
from backup import LOG_DIR, load_config, log, pause_before_exit, resolve_ssh_target

DEFAULTS = {
    "repo_url": "https://github.com/blackwanz/gembel.store.git",
    "branch": "prod",
    "www_dir": "/var/www",
    "site_dir": "gembel.store",
    # Nothing by default: the web root is served as-is and nginx doesn't block dotfiles
    # (/.git/HEAD answers 200), so a db/.env copied in here would be downloadable by anyone.
    # Keep secrets outside /var/www and only list files here once nginx denies them.
    "carry_over": [],
}


class Remote:
    """Runs commands over SSH, streaming output to the log. Uses sudo -n (no password) when the
    server allows it, otherwise asks for the sudo password once and feeds it via sudo -S."""

    def __init__(self, ssh: paramiko.SSHClient, logfile):
        self.ssh, self.logfile, self.password = ssh, logfile, None

    def run(self, script: str, sudo: bool = False, check: bool = True, quiet: bool = False) -> tuple[int, str]:
        cmd = f"bash -c {shlex.quote(script)}"
        if sudo:
            cmd = f"sudo -S -p '' {cmd}" if self.password else f"sudo -n {cmd}"
        stdin, stdout, _ = self.ssh.exec_command(cmd)
        if sudo and self.password:
            stdin.write(self.password + "\n")
            stdin.flush()
        chan = stdout.channel
        out, err, buf = [], "", ""
        started = last = time.monotonic()
        while True:
            got = False
            while chan.recv_ready():
                buf += chan.recv(65536).decode(errors="replace")
                got = True
            while chan.recv_stderr_ready():
                err += chan.recv_stderr(65536).decode(errors="replace")
                got = True
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                out.append(line.rstrip())
                if not quiet:
                    log(f"[remote] {line.rstrip()}", self.logfile)
            if got:
                last = time.monotonic()
            elif chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
                break
            elif time.monotonic() - last >= backup.HEARTBEAT_SECONDS:
                print(f"    ... masih jalan ({int(time.monotonic() - started)} detik), jangan ditutup", flush=True)
                last = time.monotonic()
            time.sleep(0.2)
        if buf.strip():
            out.append(buf.rstrip())
            if not quiet:
                log(f"[remote] {buf.rstrip()}", self.logfile)
        code = chan.recv_exit_status()
        if err.strip() and not quiet:
            log(f"[remote-stderr] {err.strip()}", self.logfile)
        if check and code != 0:
            raise RuntimeError(f"Remote command failed (exit {code}): {script.strip().splitlines()[0][:120]}")
        return code, "\n".join(out)

    def ensure_sudo(self) -> None:
        code, _ = self.run("true", sudo=True, check=False, quiet=True)
        if code == 0:
            return
        self.password = getpass.getpass("Password sudo di server (gak ditampilin): ")
        code, _ = self.run("true", sudo=True, check=False, quiet=True)
        if code != 0:
            raise RuntimeError("Password sudo salah / user gak punya akses sudo.")


def main() -> int:
    dry = "--dry" in sys.argv
    skip_backup = "--skip-backup" in sys.argv
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"deploy-{stamp}.log"

    with open(log_path, "w", encoding="utf-8") as logfile:
        try:
            cfg = {**DEFAULTS, **load_config()}
            www, site = cfg["www_dir"].rstrip("/"), cfg["site_dir"]
            live, new, old = f"{www}/{site}", f"{www}/{site}.new-{stamp}", f"{www}/{site}.backup-{stamp}"
            q = shlex.quote

            target = resolve_ssh_target(cfg["ssh_alias"])
            log(f"Connecting to {target['username']}@{target['hostname']}:{target['port']} "
                f"(alias '{cfg['ssh_alias']}'){'  [DRY RUN]' if dry else ''}", logfile)
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(hostname=target["hostname"], port=target["port"], username=target["username"],
                        key_filename=target["key_path"], timeout=30)
            r = Remote(ssh, logfile)

            # ---- 0. where are we
            r.run(f"""
                cd {q(www)}
                if [ -L {q(site)} ]; then echo "live: symlink -> $(readlink {q(site)})"
                elif [ -d {q(site)} ]; then echo "live: folder ($(du -sh {q(site)} | cut -f1))"
                else echo "live: (belum ada)"; fi
                if [ -d {q(site)}/.git ]; then echo "commit sekarang: $(git -C {q(site)} log -1 --format='%h %s' 2>/dev/null)"; fi
                echo "commit terbaru di GitHub ({cfg['branch']}): $(git ls-remote {q(cfg['repo_url'])} refs/heads/{q(cfg['branch'])} | cut -c1-7)"
                echo "db/.env di server: $([ -f {q(site)}/db/.env ] && echo ada || echo GAK ADA)"
                echo "backup folder yang udah ada: $(ls -d {q(site)}.backup-* 2>/dev/null | wc -l)"
            """)

            if dry:
                log("Rencana (gak dijalanin karena --dry):", logfile)
                for step in [
                    "backup penuh (bksource.sh + dumpdb.sh) + download ke laptop" if not skip_backup else "backup penuh DILEWATIN (--skip-backup)",
                    f"git clone -b {cfg['branch']} -> {new}",
                    f"mv {live} -> {old}",
                    f"mv {new} -> {live}",
                    f"copy dari folder lama: {', '.join(cfg['carry_over']) or '-'}",
                ]:
                    log(f"  - {step}", logfile)
                r.ensure_sudo()
                log("sudo OK. Dry run selesai, gak ada yang diubah.", logfile)
                ssh.close()
                return 0

            # ---- 1. backup
            if skip_backup:
                log("Backup penuh dilewatin (--skip-backup). Folder lama tetap disimpen di langkah 3.", logfile)
            else:
                log("== 1/4 Backup dulu (source + database) ==", logfile)
                backup.run_remote_scripts(ssh, cfg, logfile)
                local_dir = backup.download_latest_backups(ssh, cfg, logfile)
                log(f"Backup kesimpen di {local_dir}", logfile)

            r.ensure_sudo()

            # ---- 2. clone next to the live site
            log(f"== 2/4 Clone {cfg['repo_url']} ({cfg['branch']}) ==", logfile)
            r.run(f"""
                set -e
                git clone --depth 1 -b {q(cfg['branch'])} {q(cfg['repo_url'])} {q(new)}
                test -f {q(new)}/index.html || {{ echo "index.html gak ada di hasil clone, batal"; rm -rf {q(new)}; exit 1; }}
            """, sudo=True)

            # ---- 3. swap (old folder kept as the rollback copy)
            log("== 3/4 Tuker folder ==", logfile)
            carry = "\n".join(
                f"if [ -e {q(old + '/' + p)} ]; then mkdir -p \"$(dirname {q(live + '/' + p)})\"; "
                f"cp -a {q(old + '/' + p)} {q(live + '/' + p)}; echo 'dibawa: {p}'; fi"
                for p in cfg["carry_over"])
            r.run(f"""
                set -e
                cd {q(www)}
                if [ -e {q(site)} ] || [ -L {q(site)} ]; then mv {q(site)} {q(old)}; echo "folder lama -> {old}"; fi
                if ! mv {q(new)} {q(site)}; then
                  echo "GAGAL pindahin folder baru, balikin yang lama"
                  [ -e {q(old)} ] && mv {q(old)} {q(site)}
                  exit 1
                fi
                {carry}
            """, sudo=True)

            # ---- 4. report
            log("== 4/4 Cek ==", logfile)
            r.run(f"""
                echo "live sekarang: $(git -C {q(live)} log -1 --format='%h %s (%cr)')"
                echo "jumlah file: $(find {q(live)} -type f -not -path '*/.git/*' | wc -l)"
                echo "rollback kalau perlu: sudo rm -rf {live} && sudo mv {old} {live}"
            """, sudo=True)
            ssh.close()
            log(f"DEPLOY SELESAI. Log: {log_path}", logfile)
            return 0
        except Exception as exc:
            log(f"DEPLOY GAGAL: {exc}", logfile)
            return 1


if __name__ == "__main__":
    code = main()
    pause_before_exit()
    sys.exit(code)
