// -----JS CODE-----
// MLController.js
// Version: 0.0.1
// Event: Initialized
// Description: Manages Ml Controller input and ouput data
// Provides a getBoxes api that returns list of bounding boxes of detected objects 

// @input Component.MLComponent mlComponent


// @input bool advanced = false
// @input string outputCls = "cls"   {"showIf":"advanced"}
// @input string outputLoc = "loc"   {"showIf":"advanced"}
//@input float confidenceThreshold = 0.45 {"showIf":"advanced"}
//@input float nmsThreshold = 0.45 {"showIf":"advanced"} 
//@input int topK = 10 {"showIf":"advanced", "hint" : "Filter only top_k boxes (before nms) with the highest confidence"}
// @input SceneObject loader {"showIf":"advanced"}

var maxKeepLength = 30;

var locData;
var classData;
var inputTransformer;
var anchors;
var all_scores;
var all_boxes;


if (!script.mlComponent) {
    debugPrint("Error, MLComponent is not set");
    return false;
}
if (!script.mlComponent.model) {
    debugPrint("Error, MLComponent model is not set");
    return false;
}

var mlcomponent = script.mlComponent;
mlcomponent.onLoadingFinished = wrapFunction(mlcomponent.onLoadingFinished, onLoadingFinished);

function onLoadingFinished() {

    var inputPlaceholder = mlcomponent.getInput("data");

    if (inputPlaceholder.texture == null) {
        debugPrint("Error, Set Input Texture on the ML Component");
        return;
    }

    try {
        classData = mlcomponent.getOutput(script.outputCls).data;
        locData = mlcomponent.getOutput(script.outputLoc).data;

    } catch (e) {
        debugPrint(e + ". Please set class and location output names to match model output names");
        return;
    }

    inputTransformer = inputPlaceholder.transformer;
    var shape = mlcomponent.getOutput(script.outputLoc).shape;
    computeAnchorCenters(shape.x, shape.y);

    script.getDetections = getDetections;
    script.getMaxDetectionsCount = getMaxDetectionsCount;

    if (script.loader) {
        script.loader.enabled = false;
    } else {
        debugPrint("Warning, please set Loader SceneObject");
    }
    
    mlcomponent.runScheduled(true, MachineLearning.FrameTiming.Update, MachineLearning.FrameTiming.Update);
}

function getDetections() {
    return postprocessDetections(classData, locData, script.confidenceThreshold, script.nmsThreshold, script.topK);
}

function getMaxDetectionsCount() {
    return Math.max(script.topK, maxKeepLength);
}

//helper functions

function debugPrint(text) {
    print("MLController, " + text);
}

function wrapFunction(origFunc, newFunc) {
    if (!origFunc) {
        return newFunc;
    }
    return function() {
        origFunc();
        newFunc();
    };
}
//detection postprocessing functions 

function computeAnchorCenters(width, height) {
    /*Compute anchors for the given image size and settings.
    Returns:
        anchors (num_anchors, 2): The anchor boxes represented as [[center_x, center_y]].
    */
    anchors = Array(width * height);
    var i = 0;
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var cx = (x + 0.5) / width;
            var cy = (y + 0.5) / height;
            anchors[i] = [cx, cy];
            i++;
        }
    }

    all_boxes = Array(anchors.length);
    all_scores = Array(anchors.length);
}

function get_item(x, i) {
    return [x[i * 4], x[i * 4 + 1], x[i * 4 + 2], x[i * 4 + 3]];
}

function transformPoint(x, y, mat) {
    var v = new vec3(x, y, 1);
    var x1 = mat.column0.dot(v);
    var y1 = mat.column1.dot(v);
    return new vec2(x1, y1);
}

function postprocessDetections(cls_out, loc_out, score_thresh, nms_thresh, top_k) {
    /*Process predicted loc/cls back to real box locations.
    Args:
        model_out: (dict) ouputs from mlcomponent.data.
        score_thresh: (float) threshold for object confidence score.
        nms_thresh: (float) threshold for box nms.
        top_k: (int) filter only top_k boxes (before nms) with the highest confidence
    Returns:
        result: (dict) {boxes, scores}.
    */


    var num_candidates = 0;
    for (var j = 0; j < anchors.length; j++) {
        var score = cls_out[j];
        if (score > score_thresh) {
            var box1 = get_item(loc_out, j);
            var anchor1 = anchors[j];
            var bx = anchor1[0] + box1[0];
            var by = anchor1[1] + box1[1];
            var bw = box1[2] * 0.5;
            var bh = box1[3] * 0.5;

            all_boxes[num_candidates] = [bx - bw, by - bh, bx + bw, by + bh];
            all_scores[num_candidates] = score;
            num_candidates++;
        }
    }

    var nms_res = nms(all_boxes.slice(0, num_candidates), all_scores.slice(0, num_candidates), nms_thresh, top_k);
    var keep = nms_res["keep"];
    var num_kept = nms_res["num_kept"];
    var boxes = Array(num_kept);
    var scores = Array(num_kept);
    for (var k = 0; k < num_kept; k++) {
        var box0 = all_boxes[keep[k]];
        var x = Math.max(Math.min(1, 2 * box0[0] - 1), -1);
        var y = Math.max(Math.min(1, 1 - (2 * box0[3])), -1);
        var w = Math.max(Math.min(2, 2 * (box0[2] - box0[0])), 0) * 0.5;
        var h = Math.max(Math.min(2, 2 * (box0[3] - box0[1])), 0) * 0.5;

        var topLeft = transformPoint(x - w, y - h, inputTransformer.inverseMatrix);
        var bottomRight = transformPoint(x + w, y + h, inputTransformer.inverseMatrix);

        x = (topLeft.x + bottomRight.x) * 0.5;
        y = (topLeft.y + bottomRight.y) * 0.5;
        w = bottomRight.x - topLeft.x;
        h = bottomRight.y - topLeft.y;

        boxes[k] = [x, y, w, h];
        scores[k] = all_scores[keep[k]];
    }

    var result = { boxes: boxes, scores: scores };

    return result;
}

// nms algorithm implementation




function nms(boxes, scores, threshold, top_k) {
    /*Non maximum suppression.

    Args:
      bboxes: (array) bounding boxes, sized [N,4].
      scores: (array) confidence scores, sized [N].
      threshold: (float) overlap threshold
      top_k: (int) return no more than min(30, top_k) indices.

    Returns:
      keep: (array) selected indices.
    */
    var indexOfArea = 4;
    var indexOfBox = 6;

    var keep = Array(Math.min(top_k, maxKeepLength));

    var idx = Array(scores.length);  // Array [x1, y1, x2, y2, areas, score, index]
    for (var i = 0; i < scores.length; i++) {
        var box = boxes[i];
        idx[i] = [box[0], box[1], box[2], box[3], (box[2] - box[0]) * (box[3] - box[1]),
            scores[i], i];  // Add index column for later usage
    }
    idx.sort(function(a, b) {
        return a[5] - b[5]; 
    });  // Sort in ascending order
    var last;
    var num_kept = 0;
    var idx_len = idx.length;
    while (idx_len > 0) {
        // Select element with the highest score
        idx_len--;
        last = idx[idx_len];
        keep[num_kept] = last[indexOfBox];
        num_kept++;
        if (num_kept > maxKeepLength || num_kept == top_k) {
            break;
        }
        if (idx_len == 0) {
            break;
        }
        // Remove all bboxes with higher threshold
        var counter = 0;
        for (var j = 0; j < idx_len; j++) {
            var row = idx[j];
            var xx1 = Math.max(last[0], row[0]);
            var yy1 = Math.max(last[1], row[1]);
            var xx2 = Math.min(last[2], row[2]);
            var yy2 = Math.min(last[3], row[3]);

            var inter = Math.max(0, xx2 - xx1) * Math.max(0, yy2 - yy1);

            var overlap = inter / (row[indexOfArea] + last[indexOfArea] - inter);
            if (overlap < threshold) {
                idx[counter] = row;
                counter++;
            }
        }
        idx_len = counter;
    }
    return { "keep": keep, "num_kept": num_kept };
}