#!/bin/bash
#SBATCH --job-name=test_job          # Job name
#SBATCH --output=slurm-%j.out        # Output file (%j = job ID)
#SBATCH --error=slurm-%j.err         # Error file
#SBATCH --partition=enccs            # Partition to use
#SBATCH --ntasks=1                   # Number of tasks (MPI processes)
#SBATCH --cpus-per-task=1            # Number of CPU cores per task
#SBATCH --time=00:05:00              # Time limit (HH:MM:SS)

# Print some info
echo "Running on host $(hostname)"
echo "Job started at $(date)"

# Run your command here
srun ./stream_c.exe

echo "Job finished at $(date)"