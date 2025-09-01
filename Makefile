BUILD_IMAGE ?= johan/slurm
PUSH_IMAGE ?= johan/slurm

build:
	docker build -t $(BUILD_IMAGE) . 
push:
	docker tag $(BUILD_IMAGE) $(PUSH_IMAGE) 
	docker push $(PUSH_IMAGE)

run:
	docker run -it -p 28888:8888 $(PUSH_IMAGE)
