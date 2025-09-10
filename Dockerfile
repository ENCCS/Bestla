#FROM docker.io/tensorflow/tensorflow:2.18.0rc0-gpu
FROM docker.io/ubuntu:22.04

USER root

RUN apt-get update
RUN apt-get install -y software-properties-common
RUN add-apt-repository ppa:deadsnakes/ppa
RUN apt-get update
RUN DEBIAN_FRONTEND="noninteractive" TZ="Europe/Stockholm" apt-get install -y python3.11 npm wget vim curl python3.11-venv python3.11-distutils nano openssh-server sudo
# Install EESSI-related packages
RUN wget https://ecsft.cern.ch/dist/cvmfs/cvmfs-release/cvmfs-release_4.5-1_all.deb
RUN dpkg -i cvmfs-release_4.5-1_all.deb
RUN rm -f cvmfs-release_4.5-1_all.deb
RUN apt-get update
RUN apt-get install -y cvmfs
RUN wget https://github.com/EESSI/filesystem-layer/releases/download/v0.5.0/cvmfs-config-eessi_0.5.0_all.deb
RUN dpkg -i cvmfs-config-eessi_0.5.0_all.deb
RUN rm cvmfs-config-eessi_0.5.0_all.deb
RUN apt-get clean
RUN python3.11 -m ensurepip --upgrade
RUN python3.11 -m pip install jupyterlab jupyterthemes --break-system-packages

# Install NVM (Node Version Manager)
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash \
    && export NVM_DIR="$HOME/.nvm" \
    && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" \
    && nvm install --lts && nvm use --lts
# Ensure nvm is loaded in the environment for all following layers
ENV NVM_DIR=/root/.nvm
ENV NODE_VERSION=12
ENV PATH=$NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH

# Source nvm and use it to install additional Node.js versions if needed
RUN . "$NVM_DIR/nvm.sh" && nvm install $NODE_VERSION && nvm use $NODE_VERSION
RUN node -v && npm -v

ENV NODE\_OPTIONS="--experimental-worker"
RUN jupyter notebook --generate-config

RUN DEBIAN_FRONTEND="noninteractive" TZ="Europe/Stockholm" apt-get install -y munge mariadb-client mariadb-server libmariadb-dev slurmdbd slurmd slurmctld libpmix-dev dbus
RUN mysql_install_db --user=mysql --datadir=/var/lib/mysql

# Setup Munge
RUN dd if=/dev/urandom bs=1 count=1024 >/etc/munge/munge.key
RUN chown munge:munge /etc/munge/munge.key
RUN chmod 600 /etc/munge/munge.key

# Setup Slurm environment
COPY cgroup.conf /etc/slurm
COPY slurmdbd.conf /etc/slurm/slurmdbd.conf
COPY slurm.conf /etc/slurm/slurm.conf
COPY entrypoint.sh /entrypoint.sh 
RUN mkdir -p /var/run/slurm 
RUN mkdir -p /var/lib/slurm/slurmctld
RUN chmod 755 /var/lib/slurm/slurmctld
RUN mkdir -p /var/lib/slurm/slurmctld
RUN chown -R slurm:slurm /var/lib/slurm/slurmctld
RUN chmod 755 /var/lib/slurm/slurmctld
RUN chmod +x /entrypoint.sh
RUN chmod 755 /var/run/slurm
RUN chmod 600 /etc/slurm/slurmdbd.conf

# Setup files for new user, sshd and webserver
RUN mkdir -p /etc/slurm && mkdir -p /etc/config/webpages && mkdir -p /scratch/aiuser
RUN useradd -ms /bin/bash aiuser && mkdir -p /home/aiuser
COPY webpages/server.js /etc/config/webpages/server.js
COPY apps/ /scratch/aiuser/apps/
RUN chown -R aiuser:aiuser /scratch/aiuser/

ENV JUPYTER_TOKEN enccs
# Set up EESSI environment
RUN bash -c "echo 'CVMFS_CLIENT_PROFILE="single"' > /etc/cvmfs/default.local"
RUN bash -c "echo 'CVMFS_QUOTA_LIMIT=10000' >> /etc/cvmfs/default.local"
RUN mkdir /cvmfs/software.eessi.io
RUN echo "source /cvmfs/software.eessi.io/versions/2023.06/init/bash" >> /home/aiuser/.bashrc
RUN mkdir -p /run/sshd /var/run/sshd && \
    sed -i 's/^#Port 22/Port 8822/' /etc/ssh/sshd_config && \
    sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i 's/^#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

EXPOSE 8822
ENTRYPOINT ["/entrypoint.sh"]

# Install Apptainer/Singularity
#RUN DEBIAN_FRONTEND="noninteractive" TZ="Europe/Stockholm" apt-get install -y fakeroot libfakeroot libfuse3-3 liblzo2-2 squashfs-tools uidmap
