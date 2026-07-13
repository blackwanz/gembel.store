#!/bin/bash

# Hentikan skrip jika ada error
set -e

# 1. Pastikan di branch uat dan push perubahan terbaru
git add .
git commit -m "Push Prod V01.00.00"
git push origin PROD
