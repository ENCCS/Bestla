#!/bin/bash

docker run -v $(pwd):/root --env-file env.list -it -p 8888:8888 registry.ice.ri.se/ssdl/datacube  
