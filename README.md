# Virtual Training Environment for HPC
This repository provides a containerized software stack for introducing new users into HPC environments without the need of accessing real systems. The VTE contains the following softwares and features installed as of v0.1:

* SLURM (in standalone mode, 1 node)
* JupyterLab (userspace)
* NodeJS (web serving)
* OpenSSH server

Pieced together, these softwares allow the user to follow the typical HPC workflow for access: inserting a public key into a portal, SSH into non-conventional ports (e.g. 8822, used by MeluXina), submit code in SLURM, and access Jupyter when necessary.

### Running the Service
The requirement for the execution of the code is solely Docker, which can be installed following the [instructions](https://docs.docker.com/engine/install/) according to your operating system. The code should also work on Windows Subsystem for Linux, which is preferred than the native Docker for Windows. This has not been tested in Podman.

You can either build the image (see section below) or download directly the image from Dockerhub. The image is only available for x86 architecture as of Sep. 4th, 2025. To download the image, try: *(temporary repository)*
```bash
docker pull raijenki/slurm:latest
```

After obtaining the image, one may run:
```bash
sudo docker run -it -d --network host raijenki/slurm
```

This will execute the container on the background, let it run for around 30 seconds to 1 minute before proceeding so all the services can properly start. Docker will make use of the same network as the host, avoiding the necessary hassle of exposing ports manually. If, however, this is necessary for some reason, one might need then to expose the ports 8888 (Jupyter), 8822 (SSH) and 8080 (NodeJS). An alternative one liner is:

```bash
sudo docker run -it --p 28888:8888 --p 28889:8080 --p 28890:8822 raijenki/slurm
```

### Using the Environment

After the service is up, you first need to access http://localhost:8080 (or similar, if you are forwarding ports) and use the service to insert your public SSH key. After pasting and seeing the message that it worked successfully, you can login into the environment by using the user ```aiuser```. The commmand is pretty much:

```bash
ssh aiuser@localhost -p 8822 -i /location/of/private/key 
```

There, you can run slurm commands such as ```squeue```, ```sinfo```, and ```srun```. The second command, for example, will return: 

```bash
PARTITION AVAIL  TIMELIMIT  NODES  STATE NODELIST
enccs*       up   infinite      1   idle localhost
```

An alternative to connecting is using the terminal directly from Jupyterlab, or submitting jobs in Python to slurm as well. This can be done through the service portal located in the same link described above.

### Killing the Service
Execute ```docker ps``` and first get the container name.

```bash
CONTAINER ID   IMAGE          COMMAND            CREATED          STATUS          PORTS     NAMES
a056c70ef7ec   76f9bb4f6167   "/entrypoint.sh"   52 minutes ago   Up 52 minutes             thirsty_mclaren
```

In this case, the Docker has assigned the name ```thirsty_mclaren``` to the container. We can kill it directly by using the command below:

```bash
docker container kill thirsty_mclaren
```


### Building container
You need to have both docker and git installed, so you are able to clone the container. A one liner is therefore:

```bash
git clone git@github.com:ENCCS/docker_slurm_jupyter.git && cd docker_slurm_jupyter && make
```

### Disclaimer
This code was done in connection to the Deliverable 3.1 regarding the MIMER AI-FACTORY, financed jointly by the European Union together with Vinnova. The Research Institutes of Sweden (RISE AB) and the Linköping University (LiU) are the main developers and maintainers of this code.