import {vfxQueue} from "main/vfx/vfxQueue";
import {makeColour} from "main/vfx/makeColour";
import {activeStage} from "stages/activeStage";
import {fg2} from "main/main";
import {twoPi} from "main/render";
export default(j)=> {
  const x = (vfxQueue[j][2].x * activeStage.scale) + activeStage.offset[0];
  const y = (vfxQueue[j][2].y * -activeStage.scale) + activeStage.offset[1];
  fg2.strokeStyle = makeColour(146, 217, 164, 0.7 * ((vfxQueue[j][0].frames - vfxQueue[j][1]) / vfxQueue[j][0].frames));
  fg2.lineWidth = 5;
  fg2.beginPath();
  fg2.arc(x, y, 15, twoPi, 0);
  fg2.closePath();
  fg2.stroke();
  fg2.lineWidth = 1;
  fg2.fillStyle = makeColour(146, 217, 164, 0.8 * ((vfxQueue[j][0].frames - vfxQueue[j][1]) / vfxQueue[j][0].frames));
  fg2.beginPath();
  fg2.moveTo(x + 3, y - 3);
  fg2.lineTo(x + 30, y);
  fg2.lineTo(x + 3, y + 3);
  fg2.lineTo(x, y + 30);
  fg2.lineTo(x - 3, y + 3);
  fg2.lineTo(x - 30, y);
  fg2.lineTo(x - 3, y - 3);
  fg2.lineTo(x, y - 30);
  fg2.closePath();
  fg2.fill();
};