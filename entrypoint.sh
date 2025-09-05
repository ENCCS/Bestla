#!/bin/bash

sed -i "s/REPLACE_IT/CPUs=$(nproc)/g" /etc/slurm/slurm.conf

service --status-all

echo "Mounting EESSI software stack..."
mount -t cvmfs software.eessi.io /cvmfs/software.eessi.io
source /cvmfs/software.eessi.io/versions/23.06/init/bash

echo "Starting MariaDB service..."
service mariadb start
if [ $? -ne 0 ]; then
    echo "Error: Failed to start MariaDB service"
    exit 1
fi

until mysqladmin ping -u root --silent; do
  echo "Waiting for MariaDB to be ready..."
  sleep 1
done

echo "Setting up Slurm database..."
mysql -u root <<-EOSQL
    CREATE DATABASE IF NOT EXISTS slurm_acct_db;
    CREATE USER IF NOT EXISTS 'slurm'@'localhost' IDENTIFIED BY 'slurmdbpass';
    GRANT USAGE ON *.* TO 'slurm'@'localhost';
    GRANT ALL PRIVILEGES ON slurm_acct_db.* TO 'slurm'@'localhost';
    FLUSH PRIVILEGES;
EOSQL
if [ $? -ne 0 ]; then
    echo "Error: Failed to set up Slurm database"
    exit 1
fi

echo "Starting MUNGE service..."
service munge start
if [ $? -ne 0 ]; then
    echo "Error: Failed to start MUNGE service"
    exit 1
fi

echo "Starting Slurm Database Daemonr..."
service slurmdbd start 
if [ $? -ne 0 ]; then
    echo "Error: Failed to start slurmdbd"
    exit 1
fi

echo "Waiting for Slurm Database Daemon to become ready..."
until ss -tuln | grep -q ':6819'; do
  echo "Waiting for slurmdbd to listen on port 6819..."
  sleep 1
done

echo "Registering Slurm cluster with sacctmgr..."
sacctmgr add cluster enccs -i
if [ $? -ne 0 ]; then
    echo "Error: Failed to register Slurm cluster"
    exit 1
fi

echo "Starting Slurm Controller Daemon..."
service slurmctld start
if [ $? -ne 0 ]; then
    echo "Error: Failed to start slurmctld"
    exit 1
fi

echo "Starting DBUS service..."
service dbus start
if [ $? -ne 0 ]; then
    echo "Error: Failed to start DBUS"
    exit 1
fi

echo "Starting Slurm Compute Daemon..."
service slurmd start
if [ $? -ne 0 ]; then
    echo "Error: Failed to start slurmd"
    exit 1
fi

echo "Starting web service..."
node /etc/config/webpages/server.js &
if [ $? -ne 0 ]; then
    echo "Error: Failed to start Node.js web service"
    exit 1
fi

echo "Starting SSH service..."
/usr/sbin/sshd -D -p 8822 &
if [ $? -ne 0 ]; then
    echo "Error: Failed to start SSH service"
    exit 1
fi

echo "Starting Jupyter Lab in the background..."
sudo -u aiuser nohup jupyter lab --ip 0.0.0.0 --notebook-dir /home/aiuser --no-browser > jupyter.log 2>&1 &
if [ $? -ne 0 ]; then
    echo "Error: Failed to start Jupyter Lab"
    exit 1
fi

echo "Jupyter Lab is running in the background. Check jupyter.log for details."

# Wait a moment for Jupyter to start and get the token
sleep 5

# Check if the token can be retrieved
sudo -u aiuser jupyter server list 2> /dev/null | grep -oP 'token=\K[a-f0-9]+' > /home/aiuser/jupyter-token
if [ ! -s /home/aiuser/jupyter-token ]; then
    echo "Error: Failed to retrieve Jupyter token"
    exit 1
fi
mv /home/aiuser/jupyter-token /etc/config/jupyter-token # This is a workaround since jupyter is userspace and nodejs is at systemspace

# Ensure SSH keys directories are created correctly
sudo -u aiuser nohup mkdir -p /home/aiuser/.ssh && touch /home/aiuser/.ssh/authorized_keys && chmod 700 /home/aiuser/.ssh/ && chmod 600 /home/aiuser/.ssh/authorized_keys
if [ $? -ne 0 ]; then
    echo "Error: Failed to set up SSH authorized_keys"
    exit 1
fi

echo "All services started successfully. Keeping container running..."

tail -f /dev/null
