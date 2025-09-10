CC = gcc
CFLAGS = -ffast-math -ftree-vectorizer-verbose=3 -O3 -fopenmp -DUSE_CBLAS

OPENBLAS_DIR = /cvmfs/software.eessi.io/versions/2023.06/software/linux/x86_64/amd/zen4/software/OpenBLAS/0.3.24-GCC-13.2.0
LDFLAGS = -L$(OPENBLAS_DIR)/lib -lopenblas -Wl,-rpath=$(OPENBLAS_DIR)/lib

mt-dgemm: mt-dgemm.c
	$(CC) $(CFLAGS) -o mt-dgemm mt-dgemm.c $(LDFLAGS)

clean:
	rm -f mt-dgemm *.o
