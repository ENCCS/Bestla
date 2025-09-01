# Introduction
This repository provides a containerized deployment of Slurm, featuring one control node and one compute node, along with support for JupyterLab.

To run it, type:
```bash
docker run -it -p 28888:8888 johan/slurm
```

Next, open http://localhost:28888, use **enccs** as password. 

Start a new terminal inside Jupyterlabs, and type

```bash
sinfo
```

```bash
PARTITION AVAIL  TIMELIMIT  NODES  STATE NODELIST
enccs*       up   infinite      1   idle localhost
```

```bash
srun hostname
```

```bash
c341049db665
```

## Building container
```bash
docker build -t johan/slurm .
```
