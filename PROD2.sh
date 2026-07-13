#!/bin/bash

# Hentikan skrip jika ada error
set -e

# 1. Pastikan di branch uat dan push perubahan terbaru
git pull origin prod
 sudo docker compose up -d --build --force-recreatew