import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

// Execute Anya's original generator with its output captured in memory. No source
// fixture is overwritten, and the 100 blocks are not copied or padded here.
export function readBaseWorld() {
  const sourceURL = new URL('../../backend/testdata/generate-world.mjs', import.meta.url);
  const source = readFileSync(sourceURL, 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', 'sourceURL');
  let captured;
  runInNewContext(source, {
    sourceURL: sourceURL.href, URL, fileURLToPath,
    writeFileSync: (_path, data) => { captured = data; },
  }, {timeout:1000});
  if (typeof captured !== 'string') throw new Error('Base generator must emit a JSON world');
  return JSON.parse(captured);
}

const point = (x, z) => ({x, y:0, z});
const path = (id, coordinates) => ({id, points:coordinates.map(([x,z]) => point(x,z))});
const zone = (id, kind, x1, z1, x2, z2) => ({id,kind,outline:[point(x1,z1),point(x2,z1),point(x2,z2),point(x1,z2)]});
const agent = (id, kind, x, z, yaw, extra = {}) => ({id,kind,position:point(x,z),yaw,...extra});
function arc(cx, cz, radius, from, to) {
  return Array.from({length:7}, (_,i) => {
    const angle = from + (to-from) * i / 6;
    return [Number((cx+radius*Math.cos(angle)).toFixed(4)),Number((cz+radius*Math.sin(angle)).toFixed(4))];
  });
}

export function buildWorld() {
  const world = readBaseWorld();
  world.version = 'single-junction-v2';
  // Two continuous roads through the city; only their common crossing remains.
  for (const chunk of world.chunks) chunk.roads = chunk.roads.filter(road =>
    Math.abs(Math.cos(road.yaw)) > 0.5 ? road.position.x === 32 : road.position.z === 32);

  world.spawnPoints = [
    {x:34.5,y:0,z:50,yaw:0},
    {x:29.5,y:0,z:14,yaw:Math.PI},
    {x:42,y:0,z:48,yaw:0},
  ];
  const shared = world.chunks.find(c => c.id === 'c_0_0');
  shared.version = 3;
  for (const [i,[x,z]] of [[20,20],[44,20],[20,44],[44,44]].entries())
    shared.objects.push({id:`junction-tree-${i}`,kind:'tree',position:point(x,z),yaw:0,size:{x:3.5,y:5,z:3.5},color:i%2?'#83ab65':'#71a56e',collidable:false});
  shared.objects.push({id:'shared-bus',kind:'bus',position:point(14,34.5),yaw:-Math.PI/2,size:{x:2.5,y:3,z:8.5},color:'#f1c45b',collidable:true});
  shared.agents = [
    agent('shared-priority-sign','priority',38.5,44,0,{mainRoadArms:['south','west']}),
    agent('shared-yield-sign','yield',25.5,20,Math.PI,{mainRoadArms:['south','west']}),
  ];
  shared.teaching = {
    paths:[
      path('shared-p-left',[[34.5,50],[34.5,42],...arc(29.5,34.5,5,0,-Math.PI/2),[2.5,29.5]]),
      path('shared-k-left',[[29.5,14],[29.5,22],...arc(34.5,29.5,5,Math.PI,Math.PI/2),[61.5,34.5]]),
      // Intention for the question only. The bus is a static collidable object.
      path('shared-bus-straight',[[14,34.5],[24,34.5],[40,34.5],[61.5,34.5]]),
    ],
    zones:[
      zone('shared-p-ready','checkpoint',32.3,40,36.7,44),
      zone('shared-k-ready','checkpoint',27.3,20,31.7,24),
      zone('shared-turn-conflict','conflict',29,29,35,35),
      zone('shared-bus-conflict','conflict',27,32,37,37),
      // A technical parking area for the third spawn, not painted asphalt.
      zone('shared-parking','checkpoint',39.5,45.5,44.5,50.5),
    ],signals:[],markers:[],
  };
  return world;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = new URL('./training-world.json', import.meta.url);
  const data = JSON.stringify(buildWorld()) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== data) throw new Error('training-world.json is stale');
  } else writeFileSync(output, data);
  console.log(`${fileURLToPath(output)}: ${Buffer.byteLength(data)} UTF-8 bytes`);
}
