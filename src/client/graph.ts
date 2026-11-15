/**
 * 关系图的纯计算层（无 DOM）：3D 布局、旋转、透视投影。
 * 面板用 canvas 画，测试可以直接断言这些函数。
 */

export interface GraphNodeInput {
  name: string
  scope: string
  degree: number
  type: string
}

export interface GraphNode extends GraphNodeInput {
  x: number
  y: number
  z: number
}

export interface GraphEdgeInput {
  from: string
  to: string
  score: number
}

export interface GraphPoint {
  x: number
  y: number
  z: number
}

export interface ProjectedPoint {
  x: number
  y: number
  depth: number
  scale: number
  visible: boolean
}

/** 稳定的字符串哈希，用来给节点一个确定性的初始球面位置。 */
export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededUnit(seed: number): number {
  let state = seed || 1
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return ((state >>> 0) % 100000) / 100000
}

/** 按类型分层：同类型的节点落在相近的纬度带，视觉上能看出“簇”。 */
function latitudeFor(type: string): number {
  const bands: Record<string, number> = { user: -0.55, feedback: 0.1, project: 0.62, reference: 0.3, task: 0.85 }
  return bands[type] ?? 0
}

/** 初始布局：球面分布（按类型分层），保证确定性，刷新不跳。 */
export function seedGraph(nodes: GraphNodeInput[], radius = 1): GraphNode[] {
  const total = Math.max(1, nodes.length)
  return nodes.map((node, index) => {
    const seed = hashString(node.scope + ':' + node.name)
    const longitude = (index / total) * Math.PI * 2 + seededUnit(seed) * 0.6
    const latitude = latitudeFor(node.type) + (seededUnit(seed + 7) - 0.5) * 0.5
    const ring = Math.sqrt(Math.max(0.05, 1 - latitude * latitude))
    return {
      ...node,
      x: Math.cos(longitude) * ring * radius,
      y: latitude * radius,
      z: Math.sin(longitude) * ring * radius,
    }
  })
}

function keyOf(scope: string, name: string): string {
  return scope + ':' + name
}

/**
 * 一次性力导向布局：斥力 + 边拉力 + 向球心的弱收缩。
 * 迭代次数固定，只做几十次，用于“打开视图时排版”，不参与每帧动画。
 */
export function relaxGraph(
  nodes: GraphNode[],
  edges: GraphEdgeInput[],
  options: { iterations?: number; linkDistance?: number; radius?: number } = {},
): GraphNode[] {
  const iterations = Math.max(0, options.iterations ?? 60)
  const linkDistance = options.linkDistance ?? 0.55
  const radius = options.radius ?? 1
  if (nodes.length <= 1) return nodes
  const index = new Map<string, number>()
  nodes.forEach((node, position) => {
    index.set(keyOf(node.scope, node.name), position)
    // buildGraph 的边只带记忆名，这里同时登记裸名，方便直接查找。
    if (!index.has(node.name)) index.set(node.name, position)
  })
  const positions = nodes.map(node => ({ x: node.x, y: node.y, z: node.z }))
  const pairs = edges
    .map(edge => {
      const from = index.get(edge.from)
      const to = index.get(edge.to)
      if (from === undefined || to === undefined || from === to) return null
      return { from, to, weight: Math.max(0.1, Math.min(1, edge.score / 100)) }
    })
    .filter((pair): pair is { from: number; to: number; weight: number } => pair !== null)

  for (let step = 0; step < iterations; step += 1) {
    const cooling = 0.5 * (1 - step / Math.max(1, iterations))
    const forces = positions.map(() => ({ x: 0, y: 0, z: 0 }))
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        const dx = positions[a]!.x - positions[b]!.x
        const dy = positions[a]!.y - positions[b]!.y
        const dz = positions[a]!.z - positions[b]!.z
        const squared = dx * dx + dy * dy + dz * dz + 1e-4
        const push = 0.012 / squared
        forces[a]!.x += dx * push
        forces[a]!.y += dy * push
        forces[a]!.z += dz * push
        forces[b]!.x -= dx * push
        forces[b]!.y -= dy * push
        forces[b]!.z -= dz * push
      }
    }
    for (const pair of pairs) {
      const a = positions[pair.from]!
      const b = positions[pair.to]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6
      const pull = (length - linkDistance) * 0.08 * pair.weight
      forces[pair.from]!.x += (dx / length) * pull
      forces[pair.from]!.y += (dy / length) * pull
      forces[pair.from]!.z += (dz / length) * pull
      forces[pair.to]!.x -= (dx / length) * pull
      forces[pair.to]!.y -= (dy / length) * pull
      forces[pair.to]!.z -= (dz / length) * pull
    }
    for (let position = 0; position < positions.length; position += 1) {
      const point = positions[position]!
      point.x += forces[position]!.x * cooling
      point.y += forces[position]!.y * cooling
      point.z += forces[position]!.z * cooling
      const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1
      if (length > radius * 1.35) {
        point.x = (point.x / length) * radius * 1.35
        point.y = (point.y / length) * radius * 1.35
        point.z = (point.z / length) * radius * 1.35
      }
    }
  }
  return nodes.map((node, position) => ({ ...node, ...positions[position]! }))
}

/** 绕 Y 轴（水平拖拽）与 X 轴（垂直拖拽）旋转。 */
export function rotatePoint(point: GraphPoint, rotationX: number, rotationY: number): GraphPoint {
  const cosY = Math.cos(rotationY)
  const sinY = Math.sin(rotationY)
  const x = point.x * cosY - point.z * sinY
  const z = point.x * sinY + point.z * cosY
  const cosX = Math.cos(rotationX)
  const sinX = Math.sin(rotationX)
  const y = point.y * cosX - z * sinX
  const zz = point.y * sinX + z * cosX
  return { x, y, z: zz }
}

/** 透视投影：depth 越大越远、越小越淡；相机在 z 轴正方向看向原点。 */
export function projectPoint(
  point: GraphPoint,
  options: { width: number; height: number; zoom?: number; camera?: number } = { width: 1, height: 1 },
): ProjectedPoint {
  const zoom = options.zoom ?? 1
  const camera = options.camera ?? 3.2
  const depth = camera - point.z
  const perspective = camera / Math.max(0.2, depth)
  const cx = options.width / 2
  const cy = options.height / 2
  const unit = Math.min(options.width, options.height) * 0.36 * zoom
  return {
    x: cx + point.x * unit * perspective,
    y: cy + point.y * unit * perspective,
    depth: point.z,
    scale: perspective,
    visible: depth > 0.2,
  }
}
