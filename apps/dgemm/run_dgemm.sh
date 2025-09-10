#!/bin/bash
#SBATCH --job-name=dgemm          # Job name
#SBATCH --output=slurm-%j.out        # Output file (%j = job ID)
#SBATCH --error=slurm-%j.err         # Error file
#SBATCH --partition=enccs            # Partition to use
#SBATCH --ntasks=1                   # Number of tasks (MPI processes)
#SBATCH --cpus-per-task=1            # Number of CPU cores per task
#SBATCH --time=00:05:00              # Time limit (HH:MM:SS)

module load OpenBLAS/0.3.24-GCC-13.2.0 

# Print some info
echo "Running on host $(hostname)"
echo "Job started at $(date)"

# Run your command here
srun ./mt-dgemm 2000 500

echo "Job finished at $(date)"