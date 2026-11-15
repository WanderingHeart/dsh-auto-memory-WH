import { describe, expect, it } from 'vitest'
import { buildGraph, RELATEDNESS_WEAK, type RelatednessRecord } from '../src/relatedness.ts'
import { hashString, projectPoint, relaxGraph, rotatePoint, seedGraph } from '../src/client/graph.ts'

const node = (name: string, type = 'reference', degree = 0, scope = 'user') => ({ name, scope, degree, type })

describe('graph seeding', () => {
  it('hashes stably and distinguishes names', () => {
    expect(hashString('alpha')).toBe(hashString('alpha'))
    expect(hashString('alpha')).not.toBe(hashString('beta'))
    expect(hashString('')).toBe(2166136261 >>> 0)
  })

  it('seeds the same layout for the same input', () => {
    const input = [node('a'), node('b'), node('c')]
    expect(seedGraph(input)).toEqual(seedGraph(input))
  })

  it('keeps nodes on or near the sphere and bands them by type', () => {
    const seeded = seedGraph([node('u', 'user'), node('p', 'project')], 1)
    for (const each of seeded) {
      expect(Math.hypot(each.x, each.y, each.z)).toBeCloseTo(1, 2)
    }
    expect(seeded[0]!.y).toBeLessThan(seeded[1]!.y)
  })
})

describe('graph relaxation', () => {
  it('pulls connected nodes closer together', () => {
    const nodes = seedGraph([node('a'), node('b')])
    const before = Math.hypot(nodes[0]!.x - nodes[1]!.x, nodes[0]!.y - nodes[1]!.y, nodes[0]!.z - nodes[1]!.z)
    const relaxed = relaxGraph(nodes, [{ from: 'a', to: 'b', score: 90 }], { iterations: 80 })
    const after = Math.hypot(relaxed[0]!.x - relaxed[1]!.x, relaxed[0]!.y - relaxed[1]!.y, relaxed[0]!.z - relaxed[1]!.z)
    expect(after).toBeLessThan(before)
  })

  it('keeps every node inside the radius cap', () => {
    const nodes = seedGraph([node('a'), node('b'), node('c'), node('d'), node('e')])
    const relaxed = relaxGraph(nodes, [], { iterations: 40, radius: 1 })
    for (const each of relaxed) {
      expect(Math.hypot(each.x, each.y, each.z)).toBeLessThanOrEqual(1.36)
    }
  })

  it('returns the input untouched for a single node', () => {
    const nodes = seedGraph([node('only')])
    expect(relaxGraph(nodes, [])).toBe(nodes)
  })
})

describe('graph projection', () => {
  it('rotates without changing length', () => {
    const rotated = rotatePoint({ x: 0.3, y: -0.2, z: 0.5 }, 0.7, 1.1)
    expect(Math.hypot(rotated.x, rotated.y, rotated.z)).toBeCloseTo(Math.hypot(0.3, -0.2, 0.5), 6)
  })

  it('projects the origin to the centre and scales with zoom', () => {
    const base = projectPoint({ x: 0, y: 0, z: 0 }, { width: 400, height: 300 })
    expect(base.x).toBe(200)
    expect(base.y).toBe(150)
    expect(base.scale).toBeCloseTo(1, 6)
    const zoomed = projectPoint({ x: 0.5, y: 0, z: 0 }, { width: 400, height: 300, zoom: 2 })
    const normal = projectPoint({ x: 0.5, y: 0, z: 0 }, { width: 400, height: 300, zoom: 1 })
    expect(zoomed.x - 200).toBeCloseTo((normal.x - 200) * 2, 6)
  })

  it('marks points behind the camera as invisible', () => {
    expect(projectPoint({ x: 0, y: 0, z: 10 }, { width: 100, height: 100 }).visible).toBe(false)
    expect(projectPoint({ x: 0, y: 0, z: 0 }, { width: 100, height: 100 }).visible).toBe(true)
  })
})

describe('buildGraph', () => {
  const record = (name: string, body = '', type = 'reference'): RelatednessRecord => ({ name, title: name, description: name, type, scope: 'user', body })

  it('links related records and counts degrees', () => {
    const graph = buildGraph([
      record('alpha', 'deploy pipeline memory store; see beta for the steps'),
      record('beta', 'deploy pipeline memory store steps for alpha'),
      record('gamma', 'garlic noodles with basil'),
    ])
    expect(graph.nodes.map(each => each.name).sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.from).toBe('alpha')
    expect(graph.edges[0]!.to).toBe('beta')
    const alpha = graph.nodes.find(each => each.name === 'alpha')!
    expect(alpha.degree).toBe(1)
    expect(graph.thresholds).toEqual({ weak: RELATEDNESS_WEAK, strong: 60 })
  })

  it('keeps a single highest edge per pair', () => {
    const graph = buildGraph([
      record('alpha', 'deploy pipeline memory store; see beta for the steps'),
      record('beta', 'deploy pipeline memory store steps for alpha'),
    ])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.score).toBeGreaterThanOrEqual(RELATEDNESS_WEAK)
  })

  it('drops pairs below the threshold', () => {
    const graph = buildGraph([
      record('alpha', 'deploy pipeline memory store; see beta for the steps'),
      record('beta', 'deploy pipeline memory store steps for alpha'),
    ], { threshold: 95 })
    expect(graph.edges).toHaveLength(0)
  })

  it('handles 500 records within the interactive budget', () => {
    const records = Array.from({ length: 500 }, (_, index) => record(`memory-${index}`, `shared topic number ${index % 7} deploy pipeline`))
    const started = Date.now()
    const graph = buildGraph(records)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(graph.nodes).toHaveLength(500)
  })
})
