BUILD_IMAGE ?= raijenki/slurm
PUSH_IMAGE ?= raijenki/slurm

build:
	docker build -t $(BUILD_IMAGE) . 
push:
	docker tag $(BUILD_IMAGE) $(PUSH_IMAGE) 
	docker push $(PUSH_IMAGE)
run:
	docker run -it -d --network host $(PUSH_IMAGE)
