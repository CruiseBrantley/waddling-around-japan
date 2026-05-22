#!/bin/bash
# Script to configure lighttpd as reverse proxy for the Node.js server on the Raspberry Pi
# Run: sudo bash configure_lighttpd.sh

echo "==== Configuring lighttpd as reverse proxy ===="

# Step 1: Change pihole webserver port from 80,443 to 8080,8443
echo "Step 1: Changing pihole webserver port..."
sudo sed -i 's|port = "80o,443os,\[::\]:80o,\[::\]:443os"|port = "8080,8443os,[::]:8080,[::]:8443os"|' /etc/pihole/pihole.toml
echo "Updated pihole.toml webserver port."

# Step 2: Create SSL certificate if not exists
echo "Step 2: Creating SSL certificate..."
if [ ! -f /etc/ssl/private/sirian.key ]; then
    sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/ssl/private/sirian.key \
        -out /etc/ssl/certs/sirian.crt \
        -subj '/CN=sirian.ddns.net' \
        -addext 'subjectAltName=DNS:sirian.ddns.net,DNS:localhost' 2>&1
    cat /etc/ssl/certs/sirian.crt /etc/ssl/private/sirian.key | sudo tee /etc/ssl/private/sirian.pem > /dev/null
    sudo chmod 600 /etc/ssl/private/sirian.pem
    echo "Created SSL certificate."
else
    echo "SSL certificate already exists."
fi

# Step 3: Install mod_openssl if not installed
echo "Step 3: Installing mod_openssl..."
if ! dpkg -l | grep -q lighttpd-mod-openssl; then
    sudo apt-get install -y lighttpd-mod-openssl 2>&1
    echo "Installed lighttpd-mod-openssl."
else
    echo "mod_openssl already installed."
fi

# Step 4: Create lighttpd reverse proxy configuration
echo "Step 4: Creating reverse proxy configuration..."
cat > /etc/lighttpd/conf-available/15-proxy-sirian.conf << 'CONF'
# SSL configuration for sirian.ddns.net
$SERVER["socket"] == ":443" {
  ssl.engine = "enable"
  ssl.pemfile = "/etc/ssl/private/sirian.pem"
}

# Reverse proxy for sirian.ddns.net - proxy to Node.js server on port 4000
$HTTP["host"] == "sirian.ddns.net" {
  proxy.server = (
    "" => (
      (
        "host" => "127.0.0.1",
        "port" => 4000
      )
    )
  )
}
CONF
echo "Created /etc/lighttpd/conf-available/15-proxy-sirian.conf"

# Step 5: Enable the proxy config
echo "Step 5: Enabling proxy config..."
sudo ln -sf /etc/lighttpd/conf-available/15-proxy-sirian.conf /etc/lighttpd/conf-enabled/15-proxy-sirian.conf
echo "Enabled 15-proxy-sirian.conf"

# Step 6: Validate config
echo "Step 6: Validating lighttpd config..."
sudo lighttpd -t -f /etc/lighttpd/lighttpd.conf 2>&1

# Step 7: Restart services
echo "Step 7: Restarting services..."
sudo service lighttpd restart 2>&1
echo "Restarted lighttpd"
sudo pihole restartdns 2>&1
echo "Restarted pihole DNS"

echo "==== Configuration complete! ===="
echo "Pihole admin is now at: http://<pi-ip>:8080 or https://<pi-ip>:8443"
echo "Your app is at: https://sirian.ddns.net"
echo ""
echo "IMPORTANT: Update your router port forwarding:"
echo "  - Port 80  -> Pi IP:8080"
echo "  - Port 443 -> Pi IP:8443"