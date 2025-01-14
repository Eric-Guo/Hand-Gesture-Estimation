let cnv, size;
let mobilenet, model, modelHand, capture;
let messageP, saveExamplesB;
let predictB, predictP, predictC, predictFrame;
let threshold, thresholdVal;
let count, countTrack;

const NUM_CLASSES = 5
const MAPPING = {'A': 0, 'OKAY': 1, 'PEACE': 2, 'THUMBS UP': 3, 'Y': 4}
const IMG_WIDTH = 224;
const IMG_HEIGHT = 224;

const basePath = "https://cdn.jsdelivr.net/npm/handtrackjs/models/web/"

async function setup(){
	// To have uniformity for pixels across multiple devices
	pixelDensity(1);

	// Creating the canvas
	cnv = createCanvas(IMG_WIDTH,IMG_HEIGHT);
	cnv.style('display','block');
	cnv.parent('canvas-container');

	// Creating the webcam element
	capture = createCapture(VIDEO);
	capture.parent('webcam-container');

	// Initializing the variables
	messageP = $(document.getElementById('messageP'));
	saveExamplesB = $(document.getElementById('saveExamplesB'));
	predictP = $(document.getElementById('predictP'));
	predictB = $(document.getElementById('predictB'));
	predictC = $(document.getElementById('predictC'));
	predictFrameD = $(document.getElementById('predictFrame'));
	predictFrame = true;

	if (predictFrame == true) {
		predictC.prop('checked', true);
		predictFrameD.hide();
	}
	threshold = $(document.getElementById('threshold'));
	thresholdVal = parseFloat(threshold.val());
	count = 0;

	// Loading the pretrained models
	messageP.html('Loading the model...');
	mobilenet = await loadMobileNet();
	model = await tf.loadModel('./Model/model.json');
	modelHand = await loadHandtrack();
	messageP.html('Model Loaded.');

	// Defining the properties of elements
	saveExamplesB.click(async() => {
		let pose = $(document.getElementById('pose')).val().toUpperCase();
		let numOfExamples = $(document.getElementById('numOfExamples')).val();
		if(numOfExamples<0 || numOfExamples.length<=0)
			messageP.html('Please enter a number!');
		else if(pose.length<=0)
			messageP.html('Please enter a Pose!');
		else
			saveExamples(pose, numOfExamples);
	});
	predictB.click(do_predict);
	predictC.click(() => {
		if(predictC.is(':checked')){
			predictFrameD.hide();
			predictFrame = true;
		}else{
			predictFrameD.show();
			predictFrame = false;
		}
	});
	threshold.on('input', () => {
		thresholdVal = parseFloat(threshold.val());
		messageP.html('thresholdVal: '+ thresholdVal);
	});
	capture.elt.addEventListener('loadedmetadata', () => {
		// Drawing the webcam element
		let aspectRatio = capture.width/capture.height;
		let new_width = capture.width;
		let new_height = capture.height;
		if (capture.width >= capture.height){
			new_width = IMG_WIDTH * aspectRatio;
			new_height = IMG_HEIGHT * aspectRatio;
		}
		else if (capture.width < capture.height){
			new_width = IMG_WIDTH / aspectRatio;
			new_height = IMG_HEIGHT / aspectRatio;
		}
		capture.size(new_width, new_height);
	});
}

async function draw(){
	background(0);
	image(capture,0,0);
	if(predictFrame) {
		if(countTrack%60 == 0 && modelHand !== undefined){
			await do_track();
			countTrack = 0;
		}
		countTrack++;
	}
	filter(THRESHOLD,thresholdVal);
	filter(INVERT);
	if(predictFrame){
		if(count%60 == 0 && modelHand !== undefined && mobilenet !== undefined){
			await do_predict();
			count = 0;
		}
		count++;
	}
}

async function do_track(){

}

async function do_predict(){
	let x = await createWebcamTensor();
	let activation = await mobilenet.predict(x);
	let y = tf.tidy(() => model.predict(activation).argMax(1));
	let output = await y.data();
	for(key in MAPPING)
		if(MAPPING[key] == output)
			predictP.html(`Prediction: ${key}`);
	// Memory management
	x.dispose();
	activation.dispose();
	y.dispose();
}

// Helper functions

// Returns a model that outputs an internal activation.
async function loadMobileNet(){
	const mobilenet = await tf.loadModel('https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');
	const layer = mobilenet.getLayer('conv_pw_13_relu');
	return tf.model({inputs: mobilenet.inputs, outputs: layer.output});
}

class ObjectDetection {
  constructor() {
    this.modelParams = {
		  flipHorizontal: true,
		  outputStride: 16,
		  imageScaleFactor: 0.7,
		  maxNumBoxes: 2,
		  iouThreshold: 0.5,
		  scoreThreshold: 0.99,
		  modelType: "ssdlitemobilenetv2"
		}
    this.modelPath = basePath + this.modelParams.modelType + "/tensorflowjs_model.pb";
    this.weightPath = basePath + this.modelParams.modelType + "/weights_manifest.json";
  }

  async load() {
    this.model = await tf.loadFrozenModel(this.modelPath, this.weightPath);

    // Warmup the model.
    const result = await this.model.executeAsync(tf.zeros([1, 300, 300, 3]));
    result.map(async (t) => await t.data());
    result.map(async (t) => t.dispose());
    // console.log("modelHand loaded and warmed up")
    return this.model;
  }

  async detect(input) {

    const [height, width] = getInputTensorDimensions(input);
    const resizedHeight = getValidResolution(this.modelParams.imageScaleFactor, height, this.modelParams.outputStride);
    const resizedWidth = getValidResolution(this.modelParams.imageScaleFactor, width, this.modelParams.outputStride);

    const batched = tf.tidy(() => {
      const imageTensor = tf.fromPixels(input)
      if (this.modelParams.flipHorizontal) {
        return imageTensor.reverse(1).resizeBilinear([resizedHeight, resizedWidth]).expandDims(0);
      } else {
        return imageTensor.resizeBilinear([resizedHeight, resizedWidth]).expandDims(0);
      }
    })

    // const result = await this.model.executeAsync(batched);
    self = this;
    return this.model.executeAsync(batched).then(function (result) {
      const scores = result[0].dataSync()
      const boxes = result[1].dataSync()

      // clean the webgl tensors
      batched.dispose()
      tf.dispose(result)

      // console.log("scores result",scores, boxes)

      const [maxScores, classes] = calculateMaxScores(scores, result[0].shape[1], result[0].shape[2]);
      const prevBackend = tf.getBackend()
      // run post process in cpu
      tf.setBackend('cpu')
      const indexTensor = tf.tidy(() => {
        const boxes2 = tf.tensor2d(boxes, [
          result[1].shape[1],
          result[1].shape[3]
        ])
        return tf.image.nonMaxSuppression(
          boxes2,
          scores,
          self.modelParams.maxNumBoxes, // maxNumBoxes
          self.modelParams.iouThreshold, // iou_threshold
          self.modelParams.scoreThreshold // score_threshold
        )
      })
      const indexes = indexTensor.dataSync()
      indexTensor.dispose()
      // restore previous backend
      tf.setBackend(prevBackend)

      const predictions = self.buildDetectedObjects(
        width,
        height,
        boxes,
        scores,
        indexes,
        classes
      )

      return predictions;
    })

  }

  buildDetectedObjects(width, height, boxes, scores, indexes, classes) {
    const count = indexes.length
    const objects = []
    for (let i = 0; i < count; i++) {
      const bbox = []
      for (let j = 0; j < 4; j++) {
        bbox[j] = boxes[indexes[i] * 4 + j]
      }
      const minY = bbox[0] * height
      const minX = bbox[1] * width
      const maxY = bbox[2] * height
      const maxX = bbox[3] * width
      bbox[0] = minX
      bbox[1] = minY
      bbox[2] = maxX - minX
      bbox[3] = maxY - minY
      objects.push({
        bbox: bbox,
        class: classes[indexes[i]],
        score: scores[indexes[i]]
      })
    }
    return objects
  }

  dispose() {
    if (this.model) {
      this.model.dispose();
    }
  }
}

async function loadHandtrack() {
  const objectDetection = new ObjectDetection();
  return objectDetection.load();
}

// Function to save the canvas as example for training the model
// The pose label and the number of examples to save is given by the user
async function saveExamples(pose, numOfExamples){
	messageP.html('Adding Examples...');
	let poseCount = 1;
	for(let i=1 ; i<=numOfExamples ; i++){
		messageP.html(`Example ${i}`);
		save(`${pose}(${poseCount}).jpg`)
		for(let i=0 ; i<10 ; i++)
			await tf.nextFrame();
		poseCount++;
	}
	messageP.html('Done adding Examples.');
}

// Function to take the canvas and convert it to a tensor with the format of MobileNet
function createWebcamTensor(){
	// Get the img from the canvas and normalize the values
	let webcamImg = [];
	loadPixels();
	for(let j=0 ; j<height ; j++){
		for(let i=0 ; i<width ; i++){
			let pix = (i + j*width)*4;
			webcamImg.push(map(pixels[pix+0], 0, 255, -1, 1));
			webcamImg.push(map(pixels[pix+1], 0, 255, -1, 1));
			webcamImg.push(map(pixels[pix+2], 0, 255, -1, 1));
		}
	}
	webcamImg = tf.tensor4d(webcamImg, [1, 224, 224, 3]);
	return webcamImg;
}
