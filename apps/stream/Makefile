CC = gcc
CFLAGS = -O2 -fopenmp

FC = gfortran
FFLAGS = -O2 -fopenmp

all: stream_c.exe

stream_c.exe: stream.c
        $(CC) $(CFLAGS) stream.c -o stream_c.exe

clean:
        rm -f stream_f.exe stream_c.exe *.o