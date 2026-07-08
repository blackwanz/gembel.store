# Gunakan web server Nginx yang ringan untuk serve HTML statis
FROM nginx:alpine

# Salin semua file HTML, CSS, JS dari VPS kamu ke folder default Nginx
COPY . /usr/share/nginx/html

# Expose port 80 (port default web)
EXPOSE 80
