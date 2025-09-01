#!/bin/bash

sed -i "s/REPLACE_IT/CPUs=$(nproc)/g" /etc/slurm/slurm.conf

service --status-all

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

echo "Starting Jupyter Lab..."
jupyter lab --allow-root --ip 0.0.0.0 --notebook-dir /

echo "All services started successfully. Keeping container running..."

tail -f /dev/null
