// @flow
/* eslint-disable */

import {Vec2D, getXOrYCoord, putXOrYCoord} from "../main/util/Vec2D";
import {Box2D} from "../main/util/Box2D";
import {dotProd, scalarProd, norm, orthogonalProjection} from "../main/linAlg";
import {findSmallestWithin} from "../main/util/findSmallestWithin";
import {solveQuadraticEquation} from "../main/util/solveQuadraticEquation";
import {lineAngle} from "../main/util/lineAngle";
import {extremePoint} from "../stages/util/extremePoint";
import {connectednessFromChains} from "../stages/util/connectednessFromChains";
import {moveECB} from "../main/util/ecbTransform";
import {getSurfaceFromStage} from "../stages/stage";

// eslint-disable-next-line no-duplicate-imports
import type {ECB} from "../main/util/ecbTransform";
// eslint-disable-next-line no-duplicate-imports
import type {ConnectednessFunction} from "../stages/util/connectednessFromChains";
// eslint-disable-next-line no-duplicate-imports
import type {Stage} from "../stages/stage";


const magicAngle : number = Math.PI/6;
const maximumCollisionDetectionPasses = 15;
export const additionalOffset : number = 0.00001;

// next ECB point index, counterclockwise or clockwise
function turn(number : number, counterclockwise : boolean = true ) : number {
  if (counterclockwise) {
    if (number === 3) {
      return 0;
    }
    else { 
      return number + 1;
    }
  }
  else {
    if (number === 0) {
      return 3 ;
    }
    else {
      return number - 1;
    }
  }
};

// returns true if the vector is moving into the wall, false otherwise
function movingInto (vec : Vec2D, wallTopOrRight : Vec2D, wallBottomOrLeft : Vec2D, wallType : string) : boolean {
  let sign = 1;
  switch (wallType) {
    case "l": // left wall
    case "g": // ground
    case "b":
    case "d":
    case "p": // platform
      sign = -1;
      break;
    default: // right wall, ceiling
      break;
  }
  // const outwardsWallNormal = new Vec2D ( sign * (wallTopOrRight.y - wallBottomOrLeft.y), sign*( wallBottomOrLeft.x-wallTopOrRight.x )  );
  // return ( dotProd ( vec, outwardsWallNormal ) < 0 );
  return ( dotProd ( vec, new Vec2D ( sign * (wallTopOrRight.y - wallBottomOrLeft.y), sign*(wallBottomOrLeft.x-wallTopOrRight.x) ) ) < 0);
};

// returns true if point is to the right of a "left" wall, or to the left of a "right" wall,
// and false otherwise
function isOutside (point : Vec2D, wallTopOrRight : Vec2D, wallBottomOrLeft : Vec2D, wallType : string) : boolean {
  //const vec = new Vec2D ( point.x - wallBottom.x, point.y - wallBottom.y );
  //return ( !movingInto(vec, wallTop, wallBottom, wallType ) );
  return ( !movingInto( new Vec2D ( point.x - wallBottomOrLeft.x, point.y - wallBottomOrLeft.y ), wallTopOrRight, wallBottomOrLeft, wallType ) );
};

// say line1 passes through the two points p1 = (x1,y1), p2 = (x2,y2)
// and line2 by the two points p3 = (x3,y3) and p4 = (x4,y4)
// this function returns the parameter t, such that p3 + t*(p4-p3) is the intersection point of the two lines
// please ensure this function is not called on parallel lines
function coordinateInterceptParameter (line1 : [Vec2D, Vec2D], line2 : [Vec2D, Vec2D]) : number {
  // const x1 = line1[0].x;
  // const x2 = line1[1].x;
  // const x3 = line2[0].x;
  // const x4 = line2[1].x;
  // const y1 = line1[0].y;
  // const y2 = line1[1].y;
  // const y3 = line2[0].y;
  // const y4 = line2[1].y;
  // const t = ( (x1-x3)*(y2-y1) + (x1-x2)*(y1-y3) ) / ( (x4-x3)*(y2-y1) + (x2-x1)*(y3-y4) );
  // return t;
  return (     (line1[0].x-line2[0].x)*(line1[1].y-line1[0].y) 
             + (line1[0].x-line1[1].x)*(line1[0].y-line2[0].y) ) 
          / (  (line2[1].x-line2[0].x)*(line1[1].y-line1[0].y) 
             + (line1[1].x-line1[0].x)*(line2[0].y-line2[1].y) );
};

// find the intersection of two lines
// please ensure this function is not called on parallel lines
export function coordinateIntercept (line1 : [Vec2D, Vec2D], line2 : [Vec2D, Vec2D]) : Vec2D {
  const t = coordinateInterceptParameter(line1, line2);
  return ( new Vec2D( line2[0].x + t*(line2[1].x - line2[0].x), line2[0].y + t*(line2[1].y - line2[0].y) ) );
};


// finds whether the ECB impacted a surface on one of its vertices
// if so, returns the sweeping parameter for that collision; otherwise returns null
function pointSweepingCheck ( wall : [Vec2D, Vec2D], wallType : string, wallIndex : number
                            , wallBottomOrLeft : Vec2D, wallTopOrRight : Vec2D
                            , stage : Stage, connectednessFunction : ConnectednessFunction
                            , xOrY : number, same : number
                            , ecb1 : ECB, ecbp : ECB ) : null | number {

  let relevantECB1Point = ecb1[same];
  let relevantECBpPoint = ecbp[same];

  if (wallType === "l" || wallType === "r") { // left or right wall, might need to check top or bottom ECB points instead
    let sign = 1;
    if (wallType === "l") {
      sign = -1;
    }
    const wallAngle      = lineAngle([wallBottomOrLeft, wallTopOrRight]);
    const bottomECBAngle = lineAngle([ecbp[0]         , ecbp[same]    ]);
    const topECBAngle    = lineAngle([ecbp[same]      , ecbp[2]       ]);
    if (sign * wallAngle < sign * topECBAngle) {
      relevantECB1Point = ecb1[2];
      relevantECBpPoint = ecbp[2];
    }
    else if (sign * wallAngle > sign * bottomECBAngle) {
      relevantECB1Point = ecb1[0];
      relevantECBpPoint = ecbp[0];
    }
  }

  if ( !isOutside(relevantECB1Point, wallTopOrRight, wallBottomOrLeft, wallType) || isOutside(relevantECBpPoint, wallTopOrRight, wallBottomOrLeft, wallType) ) {
    return null; // ECB did not cross the surface in the direction it can stop the ECB
  }
  else {
    const s = coordinateInterceptParameter (wall, [relevantECB1Point, relevantECBpPoint]); // need to put wall first

    if (s > 1 || s < 0 || isNaN(s) || s === Infinity) {
      console.log("'pointSweepingCheck': no collision with "+wallType+" surface, sweeping parameter outside of allowable range.");
      return null; // no collision
    }
    else {
      const intersection = new Vec2D (relevantECB1Point.x + s*(relevantECBpPoint.x-relevantECB1Point.x), relevantECB1Point.y + s*(relevantECBpPoint.y-relevantECB1Point.y));
      if (getXOrYCoord(intersection, xOrY) > getXOrYCoord(wallTopOrRight, xOrY) || getXOrYCoord(intersection, xOrY) < getXOrYCoord(wallBottomOrLeft, xOrY)) {
        console.log("'pointSweepingCheck': no collision, intersection point outside of "+wallType+" surface.");
        return null; // no collision
      }
      else {
        console.log("'pointSweepingCheck': collision, crossing relevant ECB point, "+wallType+" surface. Sweeping parameter s="+s+".");
        return s ;
      }
    }
  }
};

// in this function, we are considering a line that is sweeping,
// from the initial line 'line1' passing through the two points p1 = (x1,y1), p2 = (x2,y2)
// to the final line 'line2' passing through the two points p3 = (x3,y3) and p4 = (x4,y4)
// there are two sweeping parameters: 
//   't', which indicates how far along each line we are
//   's', which indicates how far we are sweeping between line1 and line2 (the main sweeping parameter)
// for instance:
//  s=0 means we are on line1,
//  s=1 means we are on line2,
//  t=0 means we are on the line between p1 and p3,
//  t=1 means we are on the line between p2 and p4
// this function returns a specific value for each of t and s,
// which correspond to when the swept line hits the origin O (at coordinates (0,0))
// if either of the parameters is not between 0 and 1, this function instead returns null
// see '/doc/linesweep.png' for a visual representation of the situation
function lineSweepParameters( line1 : [Vec2D, Vec2D], line2 : [Vec2D, Vec2D], flip : boolean = false) : [number, number] | null {
  let sign = 1;
  if (flip) {
    sign = -1;
  }
  const x1 = line1[0].x;
  const x2 = line1[1].x;
  const x3 = line2[0].x;
  const x4 = line2[1].x;
  const y1 = line1[0].y;
  const y2 = line1[1].y;
  const y3 = line2[0].y;
  const y4 = line2[1].y;

  const a0 = x2*y1 - x1*y2;
  const a1 = x4*y1 - 2*x2*y1 + 2*x1*y2 - x3*y2 + x2*y3 - x1*y4;
  const a2 = x2*y1 - x4*y1 - x1*y2 + x3*y2 - x2*y3 + x4*y3 + x1*y4 - x3*y4;

  // s satisfies the equation:   a0 + a1*s + a2*s^2 = 0
  const s = solveQuadraticEquation( a0, a1, a2, sign );

  if (s === null || isNaN(s) || s === Infinity || s < 0 || s > 1) {
    return null; // no real solution
  }
  else {
    const t = ( s*(x1 - x3) - x1) / ( x2 - x1 + s*(x1 - x2 - x3 + x4) );
    
    if (isNaN(t) || t === Infinity || t < 0 || t > 1) {
      return null;
    }
    else {
      return [t,s];
    }
  }
};


function edgeSweepingCheck( ecb1 : ECB, ecbp : ECB, same : number, other : number
                          , position : Vec2D, counterclockwise : boolean
                          , corner : Vec2D, wallType : string) : null | [string, Vec2D, number, number | null] {

  // the relevant ECB edge, that might collide with the corner, is the edge between ECB points 'same' and 'other'
  let interiorECBside = "l";   
  if (counterclockwise === false) {
    interiorECBside = "r";    
  }

  if (!isOutside ( corner, ecbp[same], ecbp[other], interiorECBside) && isOutside ( corner, ecb1[same], ecb1[other], interiorECBside) ) {

    let [t,s] = [0,0];
  
    // we sweep a line,
    // starting from the relevant ECB1 edge, and ending at the relevant ECBp edge,
    // and figure out where this would intersect the corner
    
    // first we recenter everything around the corner,
    // as the 'lineSweepParameters' function calculates collision with respect to the origin
  
    const recenteredECB1Edge = [ new Vec2D( ecb1[same ].x - corner.x, ecb1[same ].y - corner.y )
                               , new Vec2D( ecb1[other].x - corner.x, ecb1[other].y - corner.y ) ];
    const recenteredECBpEdge = [ new Vec2D( ecbp[same ].x - corner.x, ecbp[same ].y - corner.y )
                               , new Vec2D( ecbp[other].x - corner.x, ecbp[other].y - corner.y ) ];
  
    // in the line sweeping, some tricky orientation checks show that a minus sign is required precisely in the counterclockwise case
    // this is what the third argument to 'lineSweepParameters' corresponds to
    const lineSweepResult = lineSweepParameters( recenteredECB1Edge, recenteredECBpEdge, counterclockwise );
    
    if (! (lineSweepResult === null) ) {
      [t,s] = lineSweepResult;
      let newPosition = null; // initialising

      let additionalPushout = additionalOffset; // additional pushout
      if (same === 1 || other === 1) {
        additionalPushout = -additionalOffset;
      }
      
      const xIntersect = coordinateIntercept( [ ecbp[same], ecbp[other] ], [ corner, new Vec2D( corner.x+1, corner.y ) ]).x;
      newPosition = new Vec2D( position.x + corner.x - xIntersect + additionalPushout, position.y);
      let same2 = same;
      let other2 = other;
      if (same === 0 && other === 3) {
        same2 = 4;
      }
      else if (same === 3 && other === 0) {
        other2 = 4;
      }
      const angularParameter = same2 + (xIntersect - ecbp[same].x) / (ecbp[other].x - ecbp[same].x) * (other2 - same2);
      console.log("'edgeSweepingCheck': collision, relevant edge of ECB has moved across "+wallType+" corner. Sweeping parameter s="+s+".");
      return ( ["x"+wallType, newPosition, s, angularParameter] ); // s is the sweeping parameter, t just moves along the edge
    }
    else {
      console.log("'edgeSweepingCheck': no edge collision, relevant edge of ECB does not cross "+wallType+" corner.");
      return null;
    }
  }
  else {
    console.log("'edgeSweepingCheck': no edge collision, "+wallType+" corner did not switch relevant ECB edge sides.");
    return null;
  }
};

// TODO: explain this function, and include diagrams
function getHorizPushout( ecb1 : ECB, ecbp : ECB, same : number
                        , wall : [Vec2D, Vec2D], wallType : string, wallIndex : number
                        , oldTotalPushout : number, previousPushout : number
                        , situation
                        , stage : Stage, connectednessFunction : ConnectednessFunction) : [number, null | number] {
  console.log("'getHorizPushout': working with "+wallType+""+wallIndex+".");
  console.log("'getHorizPushout': pushout total was "+oldTotalPushout+".");
  console.log("'getHorizPushout': previous pushout was "+previousPushout+".");

  const wallRight  = extremePoint(wall, "r");
  const wallLeft   = extremePoint(wall, "l");
  const wallTop    = extremePoint(wall, "t");
  const wallBottom = extremePoint(wall, "b");

  const wallAngle      = lineAngle([wallBottom, wallTop   ]);
  const bottomECBAngle = lineAngle([ecbp[0]   , ecbp[same]]);
  const topECBAngle    = lineAngle([ecbp[same], ecbp[2]   ]);

  const pt = relevantECBPointFromWall(ecbp, wallBottom, wallTop, wallType);

  let UDSign = 1;
  let wallForward  = wallTop;
  let wallBackward = wallBottom;
  let fPt = 2; // forward ECB point
  let bPt = 0; // backward ECB point
  if (situation === "d") {
    UDSign = -1;
    wallForward  = wallBottom;
    wallBackward = wallTop;
    fPt = 0;
    bPt = 2;
  }

  let dir = "l"; // clockwise to go up right walls or down left walls
  if ((situation === "d") !== (wallType === "l")) {
    dir = "r"; // counterclockwise to go down right walls or up left walls
  }

  // initialisations
  let intercept = null;
  let intercept2 = null;
  let pushout = 0;
  let nextWallTypeAndIndex = null;
  let nextWall = null;
  let nextWallBottom = null;
  let nextWallTop = null;
  let nextWallForward = null;
  let nextWallBackward = null;
  let nextPt = same;
  let t = 0;
  let angularParameter = same;
  let totalPushout = oldTotalPushout;
  // end of initialisations

  // ---------------------------------------------------------------------------------------------------------------
  // start main pushout logic


  // case 1, ECB colliding at top vertex if going upwards, or at bottom vertex if going downwards
  if (pt === fPt) {
    if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
      // directly push out and end immediately thereafter
      intercept = coordinateIntercept(wall, hLineThrough(ecbp[pt]));
      pushout = pushoutClamp(intercept.x - ecbp[pt].x, wallType);
      if (Math.abs(totalPushout) > Math.abs(pushout)) {
        console.log("'getHorizPushout': cur = fwd, ecb = fwd, directly pushing out with total.");
        return [totalPushout, null];
      }
      else {
        console.log("'getHorizPushout': cur = fwd, ecb = fwd, directly pushing out.");
        return [pushout, pt];
      }
    }
    else {
      nextWallTypeAndIndex = connectednessFunction( [wallType, wallIndex], dir);
      if (nextWallTypeAndIndex === null || nextWallTypeAndIndex[0] !== wallType) {
        // slide ECB along wall, at most so that ECB backwards point is at wallForward
        // if we stop short, put the ECBp there and end
        // otherwise, do the physics calculation to get pushout, and end
        if ( UDSign * ecbp[same].y <= UDSign * wallForward.y) {
          // stopped short (didn't even get to the same side ECB point, let alone the backwards point)
          // pushout at corner and end
          [pushout, t] = putEdgeOnCorner(ecbp[same], ecbp[pt], wallForward, wallType);
          pushout = pushoutClamp(pushout, wallType);
          if (Math.abs(totalPushout) > Math.abs(pushout)) {
            console.log("'getHorizPushout': cur = fwd, ecb = same, nxt = null, directly pushing out with total.");
            return [totalPushout, null];
          }
          else {
            angularParameter = getAngularParameter(t, same, pt);
            console.log("'getHorizPushout': cur = wdf, ecb = same, nxt = null, directly pushing out.");
            return [pushout, angularParameter];
          }
        }
        else if (UDSign * ecbp[bPt].y <= UDSign * wallForward.y) {
          // stopped short of ECB backwards point
          // pushout at corner and end
          [pushout, t] = putEdgeOnCorner( ecbp[same], ecbp[bPt], wallForward, wallType);
          pushout = pushoutClamp(pushout, wallType);
          if (Math.abs(totalPushout) > Math.abs(pushout)) {
            console.log("'getHorizPushout': cur = fwd, ecb = bwd-same, nxt = null, directly pushing out with total.");
            return [totalPushout, null];
          }
          else {
            angularParameter = getAngularParameter(t, same, bPt);
            console.log("'getHorizPushout': cur = fwd, ecb = bwd-same, nxt = null, directly pushing out.");
            return [pushout, angularParameter];
          }
        }
        else {
          // didn't stop short, do the physics
          intercept = coordinateIntercept( hLineThrough( wallForward), [ecb1[bPt], ecbp[bPt]]);
          pushout = wallForward.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = fwd, ecb = bwd, nxt = null, doing physics and pushing out.");
          return [totalPushout, null];
        }
      }
      else {
        nextWall = getSurfaceFromStage(nextWallTypeAndIndex, stage);
        nextWallTop    = extremePoint(nextWall, "t");
        nextWallBottom = extremePoint(nextWall, "b");
        nextPt = relevantECBPointFromWall(ecbp, nextWallBottom, nextWallTop, wallType);
        if (nextPt === pt) {
          // slide ECB along wall, so that ECB point is at wallForward
          // then do the physics calculation to get pushout, and pass on to the next wall
          intercept = coordinateIntercept( hLineThrough( wallForward), [ecb1[bPt], ecbp[bPt]]);
          pushout = wallForward.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = fwd, ecb = fwd, nxt = fwd, doing physics and deferring.");
          return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);
        }
        else if (nextPt === same) {
          // slide ECB along wall, at most so that ECB same point is at wallForward
          // if we stop short, put the ECBp there and end
          // otherwise, do the physics calculation to get pushout, and pass on to the next wall
          if ( UDSign * ecbp[same].y <= UDSign * wallForward.y) {
            // stopped short of ECB same-side point
            // pushout at corner and end
            [pushout, t] = putEdgeOnCorner(ecbp[same], ecbp[pt], wallForward, wallType);
            pushout = pushoutClamp(pushout, wallType);
            if (Math.abs(totalPushout) > Math.abs(pushout)) {
              console.log("'getHorizPushout': cur = fwd, ecb = same-fwd, nxt = same, directly pushing out with total.");
              return [totalPushout, null];
            }
            else {
              angularParameter = getAngularParameter(t, same, pt);
              console.log("'getHorizPushout': cur = fwd, ecb = same-fwd, nxt = same, directly pushing out.");
              return [pushout, angularParameter];
            }
          }
          else {
            // didn't stop short, do the physics
            intercept = coordinateIntercept( hLineThrough(wallForward), [ecb1[same], ecbp[same]]);
            pushout = wallForward.x - intercept.x;
            totalPushout += pushoutClamp(pushout - previousPushout, wallType);
            console.log("'getHorizPushout': cur = fwd, ecb = fwd, nxt = same, doing physics and deferring.");
            return getHorizPushout( ecb1, ecbp, same
                                  , nextWall, wallType, nextWallTypeAndIndex[1]
                                  , totalPushout, pushout
                                  , situation
                                  , stage, connectednessFunction);
          }
        }
        else { // nextPt === bPt
          // slide ECB along wall, at most so that ECB backwards point is at wallForward
          // if we stop short, put the ECBp there and end
          // otherwise, do the physics calculation to get pushout, and pass on to the next wall
          if ( UDSign * ecbp[same].y <= UDSign * wallForward.y) {
            // stopped short (didn't even get to the same side ECB point, let alone the backwards point)
            // pushout at corner and end
            [pushout, t] = putEdgeOnCorner(ecbp[same], ecbp[pt], wallForward, wallType);
            pushout = pushoutClamp(pushout, wallType);
            if (Math.abs(totalPushout) > Math.abs(pushout)) {
              console.log("'getHorizPushout': cur = fwd, ecb = same-fwd, nxt = bwd, directly pushing out with total.");
              return [totalPushout, null];
            }
            else {
              angularParameter = getAngularParameter(t, same, pt);
              console.log("'getHorizPushout': cur = fwd, ecb = same-fwd, nxt = bwd, directly pushing out.");
              return [pushout, angularParameter];
            }
          }
          else if (UDSign * ecbp[bPt].y <= UDSign * wallForward.y) {
            // stopped short of ECB backwards point
            // pushout at corner and end
            [pushout, t] = putEdgeOnCorner( ecbp[same], ecbp[bPt], wallForward, wallType);
            pushout = pushoutClamp(pushout, wallType);
            if (Math.abs(totalPushout) > Math.abs(pushout)) {
              console.log("'getHorizPushout': cur = fwd, ecb = bwd-same, nxt = bwd, directly pushing out with total.");
              return [totalPushout, null];
            }
            else {
              angularParameter = getAngularParameter(t, same, pt);
              console.log("'getHorizPushout': cur = fwd, ecb = bwd-same, nxt = bwd, directly pushing out.");
              return [pushout, angularParameter];
            }
          }
          else {
            // didn't stop short, do the physics
            intercept = coordinateIntercept( hLineThrough( wallForward), [ecb1[bPt], ecbp[bPt]]);
            pushout = wallForward.x - intercept.x;
            totalPushout += pushoutClamp(pushout - previousPushout, wallType);
            console.log("'getHorizPushout': cur = fwd, ecb = bwd, nxt = bwd, doing physics and deferring.");
            return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);
          }
        }
      }
    }
  }

  // case 2, ECB colliding at bottom vertex if going upwards, or at top vertex if going downwards
  else if (pt === bPt) {
    nextWallTypeAndIndex = connectednessFunction( [wallType, wallIndex], dir);
    if (nextWallTypeAndIndex === null || nextWallTypeAndIndex[0] !== wallType) {
      // slide ECB along wall, so that ECB backwards point is at wallForward
      // if we stop short, pushout directly and end
      // otherwise, do the physics and end
      if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
        // stopped short, directly push out backwards ECB point
        intercept = coordinateIntercept(wall, hLineThrough(ecbp[pt]));
        pushout = pushoutClamp( intercept.x - ecbp[pt].x, wallType);
        if (Math.abs(totalPushout) > Math.abs(pushout)) {
          console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = null, directly pushing out with total.");
          return [totalPushout, null];
        }
        else {
          console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = null, directly pushing out.");
          return [pushout, pt];
        }
      }
      else {
        // didn't stop short, do the physics and end
        intercept = coordinateIntercept( hLineThrough( wallForward), [ecb1[bPt], ecbp[bPt]]);
        pushout = wallForward.x - intercept.x;
        totalPushout += pushoutClamp(pushout - previousPushout, wallType);
        console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = null, doing physics and pushing out.");
        return [totalPushout, null];
      }
    }
    else {
      nextWall = getSurfaceFromStage(nextWallTypeAndIndex, stage);
      nextWallTop    = extremePoint(nextWall, "t");
      nextWallBottom = extremePoint(nextWall, "b");
      if (situation === "u") {
        nextWallForward  = nextWallTop;
        nextWallBackward = nextWallBottom;
      }
      else {
        nextWallForward  = nextWallBottom;
        nextWallBackward = nextWallTop;
      }
      
      nextPt = relevantECBPointFromWall(ecbp, nextWallBottom, nextWallTop, wallType);
      if (nextPt === bPt) {
        // we can slide ECB all the way to have ECB backwards point at wallForward
        // if we stop short, pushout and end
        // otherwise, do the physics and pass on to the next wall
        if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
          // stopped short, directly push out backwards ECB point
          intercept = coordinateIntercept(wall, hLineThrough(ecbp[pt]));
          pushout = pushoutClamp( intercept.x - ecbp[pt].x, wallType);
          if (Math.abs(totalPushout) > Math.abs(pushout)) {
            console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = bwd, directly pushing out with total.");
            return [totalPushout, null];
          }
          else {
            console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = bwd, directly pushing out.");
            return [pushout, pt];
          }
        }
        else {
          intercept = coordinateIntercept( hLineThrough(wallForward), [ecb1[bPt], ecbp[bPt]]);
          pushout = wallForward.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = bwd, doing physics and deferring.");
          return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);
        }
      }
      else if (nextPt === same) {
        // slide the ECB along wall, until the same side ECB point collides with next wall
        // if we stop short, pushout and end, otherwise run the physics and pass on to the next wall
        // use the line that is parallel to the wall, but shifted by the vector (ecbp[same]-ecbp[bPt]) to find this point of collision
        intercept = coordinateIntercept( [ new Vec2D (wallBottom.x + ecbp[same].x - ecbp[bPt].x, wallBottom.y + ecbp[same].y - ecbp[bPt].y)
                                         , new Vec2D (wallTop.x    + ecbp[same].x - ecbp[bPt].x, wallTop.y    + ecbp[same].y - ecbp[bPt].y)
                                         ], nextWall);
        if (    UDSign * intercept.y    >= UDSign * nextWallForward.y 
             || UDSign * intercept.y    <= UDSign * nextWallBackward.y
             || UDSign * ecbp[nextPt].y <= UDSign * nextWallBackward.y
             || isOutside(ecbp[nextPt], nextWallTop, nextWallBottom, wallType)
           ) {
          if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
            // stopped short, directly push out backwards ECB point
            intercept2 = coordinateIntercept(wall, hLineThrough(ecbp[pt]));
            pushout = pushoutClamp( intercept2.x - ecbp[pt].x, wallType);
            if (Math.abs(totalPushout) > Math.abs(pushout)) {
              console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = same, directly pushing out with total.");
              return [totalPushout, null];
            }
            else {
              console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = same, directly pushing out.");
              return [pushout, pt];
            }
          }
          else {
            // can slide the backwards ECB point all the way to wallForward
            // warning: we are ignoring the possibility that the ECB can enter in contact at en edge on the corner nextWallForward
            // this will be caught by the edge sweeping routine, and not the point sweeping routine
            intercept2 = coordinateIntercept( hLineThrough(wallForward), [ecb1[bPt], ecbp[bPt]]);
            pushout = wallForward.x - intercept2.x;
            totalPushout += pushoutClamp(pushout - previousPushout, wallType);
            console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = same, doing physics and deferring.");
            return getHorizPushout( ecb1, ecbp, same
                                  , nextWall, wallType, nextWallTypeAndIndex[1]
                                  , totalPushout, pushout
                                  , situation
                                  , stage, connectednessFunction);
          }
        }
        else {
          // do the physics to find the pushout, with ECB same side point being in contact with next wall
          intercept2 = coordinateIntercept( hLineThrough(wallForward), [ecb1[same], ecbp[same]]);
          pushout = intercept2.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = bwd, ecb = same, nxt = same, doing physics and deferring.");
          return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);
        }

      }
      else { // nextPt === fPt
        // slide the ECB along wall, until the forward ECB point collides with next wall
        // if we stop short, pushout and end, otherwise run the physics and pass on to the next wall
        // use the line that is parallel to the wall, but shifted by the vector (ecbp[fPt] - ecbp[bPt]) to find this point of collision
        intercept = coordinateIntercept( [ new Vec2D (wallBottom.x + ecbp[fPt].x - ecbp[bPt].x, wallBottom.y + ecbp[fPt].y - ecbp[bPt].y)
                                         , new Vec2D (wallTop.x    + ecbp[fPt].x - ecbp[bPt].x, wallTop.y    + ecbp[fPt].y - ecbp[bPt].y)
                                         ], nextWall);
        if (    UDSign * intercept.y  >= UDSign * nextWallForward.y 
             || UDSign * intercept.y  <= UDSign * nextWallBackward.y
             || UDSign * ecbp[nextPt].y <= UDSign * nextWallBackward.y
             || isOutside(ecbp[nextPt], nextWallTop, nextWallBottom, wallType)
           ) {
          if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
            // stopped short, directly push out backwards ECB point
            intercept2 = coordinateIntercept(wall, hLineThrough(ecbp[pt]));
            pushout = pushoutClamp( intercept2.x - ecbp[pt].x, wallType);
            if (Math.abs(totalPushout) > Math.abs(pushout)) {
              console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = fwd, directly pushing out with total.");
              return [totalPushout, null];
            }
            else {
              console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = fwd, directly pushing out");
              return [pushout, pt];
            }
          }
          else {
            // can slide the backwards ECB point all the way to wallForward
            // warning: we are ignoring the possibility that the ECB can enter in contact at en edge on the corner nextWallForward
            // this will be caught by the edge sweeping routine, and not the point sweeping routine
            intercept2 = coordinateIntercept( hLineThrough(wallForward), [ecb1[bPt], ecbp[bPt]]);
            pushout = wallForward.x - intercept2.x;
            totalPushout += pushoutClamp(pushout - previousPushout, wallType);
            console.log("'getHorizPushout': cur = bwd, ecb = bwd, nxt = fwd, doing physics and deferring.");
            return getHorizPushout( ecb1, ecbp, same
                                  , nextWall, wallType, nextWallTypeAndIndex[1]
                                  , totalPushout, pushout
                                  , situation
                                  , stage, connectednessFunction);
          }
        }
        else {
          // do the physics to find the pushout, with ECB forward point being in contact with next wall
          intercept2 = coordinateIntercept( hLineThrough(wallForward), [ecb1[fPt], ecbp[fPt]]);
          pushout = intercept2.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = bwd, ecb = fwd, nxt = fwd, doing physics and deferring.");
          return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);
        }
      }
    }
  }

  // case 3, ECB colliding at same-side vertex (typical case for walls)
  else { // pt === same
    nextWallTypeAndIndex = connectednessFunction( [wallType, wallIndex], dir);
    if (nextWallTypeAndIndex === null || nextWallTypeAndIndex[0] !== wallType) {
      // slide ECB along wall, at most so that ECB backwards point is at wallForward
      // if we stop short, put the ECBp there and end
      // otherwise, do the physics calculation to get pushout, and end
      if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
        // stopped short: can push out side ECB point directly, so do that
        intercept = coordinateIntercept( wall, hLineThrough(ecbp[same]));
        pushout = pushoutClamp(intercept.x - ecbp[same].x, wallType);
        if (Math.abs(totalPushout) > Math.abs(pushout)) {
          console.log("'getHorizPushout': cur = same, ecb = same, nxt = null, directly pushing out with total.");
          return [totalPushout, null];
        }
        else {
          console.log("'getHorizPushout': cur = same, ecb = same, nxt = null, directly pushing out.");
          return [pushout, pt];
        }
      }
      else if (UDSign * ecbp[bPt].y <= UDSign * wallForward.y) {
        // stopped short of putting ECB backwards point at wallForward
        // pushout at corner and end
        [pushout, t] = putEdgeOnCorner( ecbp[same], ecbp[bPt], wallForward, wallType);
        pushout = pushoutClamp(pushout, wallType);
        if (Math.abs(totalPushout) > Math.abs(pushout)) {
          console.log("'getHorizPushout': cur = same, ecb = bwd-same, nxt = null, directly pushing out with total.");
          return [totalPushout, null];
        }
        else {
          angularParameter = getAngularParameter(t, same, bPt);
          console.log("'getHorizPushout': cur = same, ecb = bwd-same, nxt = null, directly pushing out.");
          return [pushout, angularParameter];
        }
      }
      else {
        // didn't stop short, do the physics
        intercept = coordinateIntercept( hLineThrough( wallForward), [ecb1[bPt], ecbp[bPt]]);
        pushout = wallForward.x - intercept.x;
        totalPushout += pushoutClamp(pushout - previousPushout, wallType);
        console.log("'getHorizPushout': cur = same, ecb = bwd-same, nxt = null, doing physics and pushing out.");
        return [totalPushout, null];
      }
    }
    else {
      nextWall = getSurfaceFromStage(nextWallTypeAndIndex, stage);
      nextWallTop    = extremePoint(nextWall, "t");
      nextWallBottom = extremePoint(nextWall, "b");
      if (situation === "u") {
        nextWallForward  = nextWallTop;
        nextWallBackward = nextWallBottom;
      }
      else {
        nextWallForward  = nextWallBottom;
        nextWallBackward = nextWallTop;
      }
      nextPt = relevantECBPointFromWall(ecbp, nextWallBottom, nextWallTop, wallType);
      if (nextPt === fPt) {
        // slide ECB along wall, at most so that forward ECB point is in contact with next wall
        // use the line that is parallel to the wall, but shifted by the vector (ecbp[fPt]-ecbp[same]) to find where the ECB forward point enters in contact with next wall
        intercept = coordinateIntercept ( [ new Vec2D (wallBottom.x + ecbp[fPt].x - ecbp[same].x, wallBottom.y + ecbp[fPt].y - ecbp[same].y)
                                          , new Vec2D (wallTop.x    + ecbp[fPt].x - ecbp[same].x, wallTop.y    + ecbp[fPt].y - ecbp[same].y)
                                          ], nextWall);
        if (    UDSign * intercept.y  >= UDSign * nextWallForward.y 
             || UDSign * intercept.y  <= UDSign * nextWallBackward.y
             || UDSign * ecbp[nextPt].y <= UDSign * nextWallBackward.y
             || isOutside(ecbp[nextPt], nextWallTop, nextWallBottom, wallType)
           ) {
          if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
            // stopped short: can push out side ECB point directly, so do that
            intercept2 = coordinateIntercept( wall, hLineThrough(ecbp[same]));
            pushout = pushoutClamp(intercept2.x - ecbp[same].x, wallType);
            if (Math.abs(totalPushout) > Math.abs(pushout)) {
              console.log("'getHorizPushout': cur = same, ecb = same, nxt = fwd, directly pushing out with total.");
              return [totalPushout, null];
            }
            else {
              console.log("'getHorizPushout': cur = same, ecb = same, nxt = fwd, directly pushing out.");
              return [pushout, pt];
            }
          }
          else {
            // can slide same side ECB point all the way to wallForward
            // warning: we are ignoring the possibility that the ECB can enter in contact at an edge on the corner nextWallForward
            // this will be caught by the edge sweeping routine, and not the point sweeping routine
            intercept2 = coordinateIntercept( hLineThrough(wallForward), [ecb1[same], ecbp[same]]);
            pushout = wallForward.x - intercept2.x;
            totalPushout += pushoutClamp(pushout - previousPushout, wallType);
            console.log("'getHorizPushout': cur = same, ecb = same, nxt = fwd, doing physics and deferring.");
            return getHorizPushout( ecb1, ecbp, same
                                  , nextWall, wallType, nextWallTypeAndIndex[1]
                                  , totalPushout, pushout
                                  , situation
                                  , stage, connectednessFunction);
          }
        }
        else {
          // do the physics to find the pushout, with ECB forward point being put in contact with next wall
          intercept2 = coordinateIntercept( hLineThrough(intercept), [ecb1[fPt], ecbp[fPt]]);
          pushout = intercept2.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = same, ecb = fwd, nxt = fwd, doing physics and deferring.");
          return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);     
        }
      }
      else if (nextPt === same) {
        // slide ECB along wall, at most so that ECB same-side piont is at wallForward
        // if we stop short, put the ECBp there and end
        // otherwise, do the physics calculation to get pushout, and pass on to the next wall
        if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
          // stopped short: can push out side ECB point directly, so do that
          intercept = coordinateIntercept( wall, hLineThrough(ecbp[same]));
          pushout = pushoutClamp(intercept.x - ecbp[same].x, wallType);
          if (Math.abs(totalPushout) > Math.abs(pushout)) {
            console.log("'getHorizPushout': cur = same, ecb = same, nxt = same, directly pushing out with total.");
            return [totalPushout, null];
          }
          else {
            console.log("'getHorizPushout': cur = same, ecb = same, nxt = same, directly pushing out.");
            return [pushout, pt];
          }
        }
        else {
          // slide ECB point to wallForward, calculate offset, and pass on to the next wall
          intercept = coordinateIntercept ( hLineThrough(wallForward), [ecb1[same], ecbp[same]]);
          pushout = wallForward.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = same, ecb = same, nxt = same, doing physics and deferring.");
          return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);
        }
      }
      else { // nextPt === bPt
        // slide ECB along wall, at most so that ECB backwards point is at wallForward
        // if we stop short, put the ECBp there and end
        // otherwise, do the physics calculation to get pushout, and pass on to the next wall
        if (UDSign * ecbp[pt].y <= UDSign * wallForward.y) {
          // stopped short: can push out same side ECB point directly, so do that
          intercept = coordinateIntercept( wall, hLineThrough(ecbp[same]));
          pushout = pushoutClamp(intercept.x - ecbp[same].x, wallType);
          if (Math.abs(totalPushout) > Math.abs(pushout)) {
            console.log("'getHorizPushout': cur = same, ecb = same, nxt = bwd, directly pushing out with total.");
            return [totalPushout, null];
          }
          else {
            console.log("'getHorizPushout': cur = same, ecb = same, nxt = bwd, directly pushing out.");
            return [pushout, pt];
          }
        }
        else if (UDSign * ecbp[bPt].y <= UDSign * wallForward.y) {
          // stopped short of ECB backwards point
          // pushout at corner and end
          [pushout, t] = putEdgeOnCorner( ecbp[same], ecbp[bPt], wallForward, wallType);
          pushout = pushoutClamp(pushout, wallType);
          if (Math.abs(totalPushout) > Math.abs(pushout)) {
            console.log("'getHorizPushout': cur = same, ecb = bwd-same, nxt = bwd, directly pushing out with total.");
            return [totalPushout, null];
          }
          else {
            angularParameter = getAngularParameter(t, same, bPt);
            console.log("'getHorizPushout': cur = same, ecb = bwd-same, nxt = bwd, directly pushing out.");
            return [pushout, angularParameter];
          }
        }
        else {
          // didn't stop short, do the physics
          intercept = coordinateIntercept( hLineThrough( wallForward), [ecb1[bPt], ecbp[bPt]]);
          pushout = wallForward.x - intercept.x;
          totalPushout += pushoutClamp(pushout - previousPushout, wallType);
          console.log("'getHorizPushout': cur = same, ecb = bwd, nxt = bwd, doing physics and deferring.");
          return getHorizPushout( ecb1, ecbp, same
                                , nextWall, wallType, nextWallTypeAndIndex[1]
                                , totalPushout, pushout
                                , situation
                                , stage, connectednessFunction);
        }
      }
    }    
  }

};


function relevantECBPointFromWall(ecb : ECB, wallBottom : Vec2D, wallTop : Vec2D, wallType : string) : number {
  let sign = 1;
  let same = 3;
  if (wallType === "l") {
    same = 1;
    sign = -1;
  }

  const wallAngle      = lineAngle([wallBottom, wallTop   ]);
  const bottomECBAngle = lineAngle([ecb[0]    , ecb[same]]);
  const topECBAngle    = lineAngle([ecb[same] , ecb[2]   ]);
 
  if (sign * wallAngle < sign * topECBAngle) {
    return 2; // top point collision
  }
  else if (sign * wallAngle > sign * bottomECBAngle) {
    return 0; // bottom point
  }
  else {
    return same; // side point
  }

};

function putEdgeOnCorner( point1 : Vec2D, point2 : Vec2D, corner : Vec2D, wallType : string) : [number, number] {
  const intercept = coordinateIntercept( [point1, point2], hLineThrough(corner));
  const pushout = pushoutClamp(corner.x - intercept.x, wallType);
  const parameter = (intercept.x - point1.x) / (point2.x - point1.x);
  return [pushout, parameter];
};

function getAngularParameter ( t : number, same : number, other : number) {
  if (same === 3 && other === 0) {
    return ((1-t)*3 + t*4);
  }
  else if (same === 0 && other === 3) {
    return ((1-t)*4 + t*3);
  }
  else {
    return ((1-t)*same + t*other);
  }
};

function biggestPushout( push1 : number, push2 : number, wallType : string) : number {
  if (wallType === "r") {
    return Math.max(push1, push2);
  }
  else {
    return Math.min(push1, push2);
  }
};

// touching data is null, or: new position, maybe wall type and index, sweeping parameter
type MaybeCenterAndTouchingDataType = null | [Vec2D, null | [string, number], number];

// ecbp : projected ECB
// ecb1 : old ECB
// function return type: either null (no collision) or a quadruple [touchingWall, proposed new player position, sweeping parameter, angular parameter]
// touchingWall is either null (for a corner collision) or the type of surface that was collided
// the sweeping parameter s corresponds to the location of the collision, between ECB1 and ECBp
// the angular parameter is the location at which the ECB is now touching the surface after being pushed out, from 0 to 4
// terminology in the comments: a wall is a segment with an inside and an outside,
// which is contained in an infinite line, extending both ways, which also has an inside and an outside
function findCollision (ecbp : ECB, ecb1 : ECB, position : Vec2D, prevPosition : Vec2D
                       , wall : [Vec2D, Vec2D], wallType : string, wallIndex : number
                       , stage : Stage, connectednessFunction : ConnectednessFunction) : null | [string, Vec2D, number, number | null] {

// STANDING ASSUMPTIONS
// the ECB can only collide a ground/platform surface on its bottom point (or a bottom edge on a corner of the ground/platform)
// the ECB can only collide a ceiling surface on its top point (or a top edge on a corner)
// the ECB can only collide a left wall on its right or top points (or a right edge on a corner)
// the ECB can only collide a right wall on its left or top points (or a left edge on a corner)
// walls and corners push out horizontally, grounds/ceilings/platforms push out vertically
// the chains of connected surfaces go clockwise:
//    - left to right for grounds
//    - top to bottom for right walls
//    - right to left for ceilings
//    - bottom to top for left walls

  const wallTop    = extremePoint(wall, "t");
  const wallBottom = extremePoint(wall, "b");
  const wallLeft   = extremePoint(wall, "l");
  const wallRight  = extremePoint(wall, "r");

  // right wall by default
  let wallTopOrRight = wallTop;
  let wallBottomOrLeft = wallBottom;
  let extremeWall = wallRight;
  let extremeSign = 1;
  let same = 3;
  let opposite = 1;
  let xOrY = 1; // y by default
  let isPlatform = false;
  let flip = false;
  let sign = 1;

  let other = 0; // this will be calculated later, not in the following switch statement

  switch(wallType) {
    case "l": // left wall
      same = 1;
      opposite = 3;
      flip = true;
      sign = -1;
      extremeWall = wallLeft;
      extremeSign = -1;
      break;
    case "p": // platform
      isPlatform = true;
    case "g": // ground
    case "b":
    case "d":
      same = 0;
      opposite = 2;
      wallTopOrRight  = wallRight;
      wallBottomOrLeft = wallLeft;
      extremeWall = wallTop;
      xOrY = 0;
      flip = true;
      sign = -1;
      break;
    case "c": // ceiling
    case "t":
    case "u":
      same = 2;
      opposite = 0;
      wallTopOrRight  = wallRight;
      wallBottomOrLeft = wallLeft;
      extremeSign = -1;
      extremeWall = wallBottom;
      xOrY = 0;
      break;
    default: // right wall by default
      break;
  }

  const wallAngle = lineAngle([wallBottomOrLeft, wallTopOrRight]);
  const checkTopInstead = (wallType === "l" || wallType === "r") && (sign * wallAngle < sign * lineAngle([ecbp[same], ecbp[2]]));

  // first check if player ECB was even near the wall
  if (    (ecbp[0].y > wallTop.y    && ecb1[0].y > wallTop.y   ) // player ECB stayed above the wall
       || (ecbp[2].y < wallBottom.y && ecb1[2].y < wallBottom.y) // played ECB stayed below the wall
       || (ecbp[3].x > wallRight.x  && ecb1[3].x > wallRight.x ) // player ECB stayed to the right of the wall
       || (ecbp[1].x < wallLeft.x   && ecb1[1].x < wallLeft.x  ) // player ECB stayed to the left of the wall
     ) {
    console.log("'findCollision': no collision, ECB not even near "+wallType+""+wallIndex+".");
    return null;
  }
  else {

    // if the surface is a platform, and the bottom ECB point is below the platform, we shouldn't do anything
    if ( isPlatform ) {
      if ( !isOutside ( ecb1[same], wallTopOrRight, wallBottomOrLeft, wallType )) {
        console.log("'findCollision': no collision, bottom ECB1 point was below p"+wallIndex+".");
        return null;
      }
    }

    // -------------------------------------------------------------------------------------------------------------------------------------------------------
    // now, we check whether the ECB is colliding on an edge, and not a vertex

    // first, figure out which is the relevant ECB edge that could collide at the corner
    // we know that one of the endpoints of this edge is the same-side ECB point of the wall,
    // we are left to find the other, which we'll call 'other'


    let counterclockwise = true; // whether (same ECB point -> other ECB point) is counterclockwise or not
    let closestEdgeCollision  = null; // null for now
    let corner : null | Vec2D = null;

    // case 1
    if ( getXOrYCoord(ecb1[same], xOrY) > getXOrYCoord(wallTopOrRight, xOrY) ) {
      counterclockwise = !flip;
      other = turn(same, counterclockwise);
      if ( getXOrYCoord(ecbp[other], xOrY) < getXOrYCoord(wallTopOrRight, xOrY) ) { 
        corner = wallTopOrRight;
      }
    }

    // case 2
    else if ( getXOrYCoord(ecb1[same], xOrY) < getXOrYCoord(wallBottomOrLeft, xOrY) ) {
      counterclockwise = flip;
      other = turn(same, counterclockwise);
      if ( getXOrYCoord(ecbp[other], xOrY) > getXOrYCoord(wallBottomOrLeft, xOrY) ) { 
        corner = wallBottomOrLeft;
      }
    }

    let edgeSweepResult = null;
    let otherEdgeSweepResult = null;
    
    if (corner !== null) {
      // the relevant ECB edge, that might collide with the corner, is the edge between ECB points 'same' and 'other'
      let interiorECBside = "l";
      if (counterclockwise === false) {
        interiorECBside = "r";    
      }

      if (!isOutside (corner, ecbp[same], ecbp[other], interiorECBside) && isOutside (corner, ecb1[same], ecb1[other], interiorECBside) ) {
        edgeSweepResult = edgeSweepingCheck( ecb1, ecbp, same, other, position, counterclockwise, corner, wallType);
      }
    }

    if (checkTopInstead) {
      // unless we are dealing with a wall where the ECB can collided on the topmost point, in whih case 'same' and 'top' are relevant
      let otherCounterclockwise = false; // whether ( same ECB point -> top ECB point) is counterclockwise
      let otherCorner = wallRight;
      if (wallType === "l") {
        otherCounterclockwise = true;
        otherCorner = wallLeft;
      }

      let otherInteriorECBside = "l";
      if (otherCounterclockwise === false) {
        otherInteriorECBside = "r";
      }

      if ( !isOutside(otherCorner, ecbp[same], ecbp[2], otherInteriorECBside) && isOutside (otherCorner, ecb1[same], ecb1[2], otherInteriorECBside) ) {
        otherEdgeSweepResult = edgeSweepingCheck( ecb1, ecbp, same, 2, position, otherCounterclockwise, otherCorner, wallType);
      }
    }

    // if only one of the two ECB edges (same-other / same-top) collided, take that one
    if (edgeSweepResult === null) {
      if (otherEdgeSweepResult !== null) {
        closestEdgeCollision = otherEdgeSweepResult;
      }
    }
    else if (otherEdgeSweepResult === null) {
      if (edgeSweepResult !== null) {
        closestEdgeCollision = edgeSweepResult;
      }
    }
    // otherwise choose the collision with smallest sweeping parameter
    else if ( otherEdgeSweepResult[2] > edgeSweepResult[2] ) {
      closestEdgeCollision = edgeSweepResult;
    }
    else {
      closestEdgeCollision = otherEdgeSweepResult;
    }
    

    // end of edge case checking
    // -------------------------------------------------------------------------------------------------------------------------------------------------------

    // -------------------------------------------------------------------------------------------------------------------------------------------------------
    // ECB vertex collision checking

    let closestPointCollision : null | [null | string, Vec2D, number, number | null] = null;
    // s = sweeping parameter
    const s = pointSweepingCheck ( wall, wallType, wallIndex
                                 , wallBottomOrLeft, wallTopOrRight
                                 , stage, connectednessFunction
                                 , xOrY, same
                                 , ecb1, ecbp);

    let additionalPushout = additionalOffset;
    if (wallType === "l" || wallType === "c") {
      additionalPushout = - additionalOffset;
    }

    if (s !== null) { // collision did occur
      if (wallType === "l" || wallType === "r") {
        let situation = "u";
        if (position.y < prevPosition.y) {
          situation = "d";
        }
        // TODO: add check that wall was not in ignore list, this ignore list might need to be reset under certain circumstances but this is going to be tricky
        const [pushout, maybeAngularParameter] = getHorizPushout( ecb1, ecbp, same
                                                                , wall, wallType, wallIndex
                                                                , 0, 0
                                                                , situation
                                                                , stage, connectednessFunction );
        console.log("'findCollision': horizontal pushout value is "+pushout+".");
        const newPointPosition = new Vec2D ( position.x + pushout + additionalPushout, position.y);
        closestPointCollision = [wallType, newPointPosition, s, maybeAngularParameter];
      }
      else {
        const newPointPosition = new Vec2D( position.x + (1-s)*ecb1[same].x + (s-1)*ecbp[same].x
                                          , position.y + (1-s)*ecb1[same].y + (s-1)*ecbp[same].y + additionalPushout);
        closestPointCollision = [wallType, newPointPosition, s, same];
      }
    }

    // end of ECB vertex collision checking
    // -------------------------------------------------------------------------------------------------------------------------------------------------------

    // -------------------------------------------------------------------------------------------------------------------------------------------------------
    // final gathering of collisions

    let [finalCollision, finalCollisionType] = [null,"(?)"];

    // if we have only one collision type (point/edge), take that one
    if (closestEdgeCollision === null ) {
      finalCollision = closestPointCollision;
      finalCollisionType = "point";
    }
    else if (closestPointCollision === null) {
      finalCollision = closestEdgeCollision;
      finalCollisionType = "edge";
    }
    // otherwise choose the collision with smallest sweeping parameter
    else if (closestEdgeCollision[2] > closestPointCollision[2]) {
      finalCollision = closestPointCollision;
      finalCollisionType = "point";
    }
    else {
      finalCollision = closestEdgeCollision;
      finalCollisionType = "edge";
    }

    if (finalCollision === null) {
      console.log("'findCollision': sweeping determined no collision with "+wallType+""+wallIndex+".");
    }
    else {
      console.log("'findCollision': "+finalCollisionType+" collision with "+wallType+""+wallIndex+" and sweeping parameter s="+finalCollision[2]+".");
    }
    return finalCollision;

  }
};

type LabelledSurface = [[Vec2D, Vec2D], [string, number]];

// this function finds the first (non-ignored) collision as the ECB1 moves to the ECBp
// return type: either null (no collision), or a new center, with a label according to which surface was collided (null if a corner)
function findClosestCollision( ecbp : ECB, ecb1 : ECB, position : Vec2D, prevPosition : Vec2D
                             , wallAndThenWallTypeAndIndexs : Array<LabelledSurface>
                             , stage : Stage, connectednessFunction : ConnectednessFunction ) : MaybeCenterAndTouchingDataType {
  const suggestedMaybeCenterAndTouchingData : Array<MaybeCenterAndTouchingDataType> = [null]; // initialise list of new collisions
  const collisionData = wallAndThenWallTypeAndIndexs.map( 
                                         // [  [ touchingWall, position, s, angularParameter ]  , touchingType ]
          (wallAndThenWallTypeAndIndex)  => [ findCollision ( ecbp, ecb1, position, prevPosition
                                                            , wallAndThenWallTypeAndIndex[0]
                                                            , wallAndThenWallTypeAndIndex[1][0], wallAndThenWallTypeAndIndex[1][1]
                                                            , stage, connectednessFunction )
                                            , wallAndThenWallTypeAndIndex[1] ]);

  for (let i = 0; i < collisionData.length; i++) {
    if (collisionData[i][0] !== null) {
      suggestedMaybeCenterAndTouchingData.push( [collisionData[i][0][1], [collisionData[i][0][0], collisionData[i][1][1]], collisionData[i][0][2] ]);
    }
  }

  return closestCenterAndTouchingType(suggestedMaybeCenterAndTouchingData);
};

// this function loops over all walls/surfaces it is provided, calculating the collision offsets that each ask for,
// and at each iteration returning the smallest possible offset (i.e. collision with smallest sweeping parameter)
function collisionRoutine ( ecbp : ECB, ecb1 : ECB, position : Vec2D, prevPosition : Vec2D
                          , relevantSurfaces : Array<LabelledSurface>
                          , stage : Stage
                          , connectednessFunction : ConnectednessFunction
                          , oldTouchingData : null | [string, number, number | null] // surface type, surface index, angular parameter
                          , oldecbSquashFactor : null | number
                          , passNumber : number
                          ) : [ Vec2D // new position
                              , null | [string, number] // collision surface type and index
                              , null | number // ECB scaling factor
                              ] {
  console.log("'collisionRoutine': pass number "+passNumber+".");
  let touchingData = oldTouchingData;
  let ecbSquashFactor = oldecbSquashFactor;

  if (passNumber > maximumCollisionDetectionPasses) {
    if (touchingData !== null) {
      ecbSquashFactor = inflateECB (ecbp, touchingData[2], relevantSurfaces);    
      return [position, [touchingData[0], touchingData[1]], ecbSquashFactor];
    }
    else {
      return [position, null, ecbSquashFactor];
    }
    
  }
  else {
    // first, find the closest collision
    const closestCollision = findClosestCollision( ecbp, ecb1, position, prevPosition
                                                 , relevantSurfaces
                                                 , stage, connectednessFunction);
    if (closestCollision === null) {
      // if no collision occured, end
      if (touchingData !== null) {
        ecbSquashFactor = inflateECB (ecbp, touchingData[2], relevantSurfaces);
        return [position, [touchingData[0], touchingData[1]], ecbSquashFactor];
      }
      else {
        return [position, null, ecbSquashFactor];
      }
    }

    else {
      // otherwise, loop
      const [newPosition, surfaceTypeAndIndex, angularParameter] = closestCollision;
      const vec = new Vec2D (newPosition.x - position.x, newPosition.y - position.y);
      const newecbp = moveECB (ecbp, vec);

      // update collision label data
      if (touchingData === null) {
        if (surfaceTypeAndIndex !== null) {
          touchingData = [surfaceTypeAndIndex[0], surfaceTypeAndIndex[1], angularParameter];
        }
      }
      // prioritise ground collisions when reporting the type of the last collision
      // warning: we are not using **position** information from just ground collisions, but from latest collision
      else if (surfaceTypeAndIndex !== null && ( surfaceTypeAndIndex[0] === "g" || surfaceTypeAndIndex[0] === "p")) {
        touchingData = [surfaceTypeAndIndex[0], surfaceTypeAndIndex[1], angularParameter];
      }

      return collisionRoutine( newecbp, ecb1, newPosition, position // might want to keep this 4th argument as prevPosition and not update it to position?
                             , relevantSurfaces
                             , stage, connectednessFunction
                             , touchingData, oldecbSquashFactor, passNumber+1);
    }
  }
};

// finds the ECB squash factor by inflating the ECB from the point on the ECB given by the angular parameter
// if angular parameter is null, instead inflates the ECB from its center
function inflateECB ( ecb : ECB, angularParameter : null | number, relevantSurfaces : Array<LabelledSurface>) : null | number {
  return 1; // TODO
}


// finds the maybeCenterAndTouchingType collision with smallest sweeping parameter
// recall that a 'maybeCenterAndTouchingType' is given by one of the following three options: 
//          option 1: 'false'                              (no collision) 
//          option 2: '[newPosition, false, s]             (collision, but no longer touching) 
//          option 3: '[newPosition, wallTypeAndIndex, s]' (collision, still touching wall with given type and index)
// s is the sweeping parameter
function closestCenterAndTouchingType(maybeCenterAndTouchingTypes : Array<MaybeCenterAndTouchingDataType>) : MaybeCenterAndTouchingDataType {
  let newMaybeCenterAndTouchingType = null;
  let start = -1;
  const l = maybeCenterAndTouchingTypes.length;

  // start by looking for the first possible new position
  for (let i = 0; i < l; i++) {
    if (maybeCenterAndTouchingTypes[i] === null ) {
      // option 1: do nothing
    }
    else {
      // options 2 or 3: we have found a possible new position
      newMaybeCenterAndTouchingType = maybeCenterAndTouchingTypes[i];
      start = i+1;
      break;
    }
  }
  if ( newMaybeCenterAndTouchingType === null || start > l) {
    // no possible new positions were found in the previous loop
    return null;
  }
  else {
    // options 2 or 3: possible new positions, choose the one with smallest sweeping parameter
    for (let j = start; j < l; j++) {
      if (maybeCenterAndTouchingTypes[j] === null ) {
        // option 1: no new position proposed
        // do nothing
      }
      // otherwise, compare sweeping parameters
      else if (maybeCenterAndTouchingTypes[j][2] < newMaybeCenterAndTouchingType[2]) {
        // next proposed position has smaller sweeping parameter, so use it instead
        newMaybeCenterAndTouchingType = maybeCenterAndTouchingTypes[j];
      }
      else {
        // discard the next proposed position
      }
    }
    return newMaybeCenterAndTouchingType;
  }
};


export function runCollisionRoutine( ecbp : ECB, ecb1 : ECB, position : Vec2D, prevPosition : Vec2D
                                   , relevantSurfaces : Array<LabelledSurface>
                                   , stage : Stage
                                   , connectednessFunction : ConnectednessFunction
                                   ) : [ Vec2D // new position
                                       , null | [string, number] // collision surface type and index
                                       , null | number // ECB scaling factor
                                       ] {
  return collisionRoutine( ecbp, ecb1, position, prevPosition
                         , relevantSurfaces
                         , stage, connectednessFunction
                         , null, null, 1);
};

function hLineThrough ( point : Vec2D ) : [Vec2D, Vec2D] {
  return [ point, new Vec2D ( point.x+1, point.y)];
};
function vLineThrough ( point : Vec2D ) : [Vec2D, Vec2D] {
  return [ point, new Vec2D ( point.x, point.y+1)];
};
function lineThrough ( point, xOrY ) : [Vec2D, Vec2D] {
  if (xOrY === 0) {
    return vLineThrough(point);
  }
  else {
    return hLineThrough(point);
  }
};

function pushoutClamp( push : number, wallType : string ) {
  switch(wallType) {
    case "r":
    case "g":
    case "p":
    default:
      return (push < 0 ? 0 : push );
    case "l":
    case "c":
      return (push > 0 ? 0 : push );
  }
};

function wallTypesAreSimilar( type1: string, type2: string ) : bool {
  if ((type1 !== "g" && type1 !== "p") || (type2 !== "g" && type2 !== "p")) {
    return (type1 === type2);
  }
  else if ( (type1 === "g" || type1 === "p") && (type2 === "g" || type2 === "p") ) {
    return true;
  }
  else {
    return false;
  }
};