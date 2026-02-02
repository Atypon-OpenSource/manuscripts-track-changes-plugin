/*!
 * © 2023 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/// <reference types="@types/jest" />;

import { Node as PMNode } from 'prosemirror-model'

import { 
  installShadowNodeFilter, 
  uninstallShadowNodeFilter, 
  isShadowNodeFilterInstalled,
  withoutShadowFilter,
  isNodeShadowFiltered
} from '../../src/utils/shadow-node-filter'
import { isShadowDelete } from '../../src/tracking/steps-trackers/qualifiers'
import { log } from '../../src/utils/logger'
import { schema } from '../utils/schema'

let counter = 0
// https://stackoverflow.com/questions/65554910/jest-referenceerror-cannot-access-before-initialization
// eslint-disable-next-line
var uuidv4Mock: jest.Mock

jest.mock('../../src/utils/uuidv4', () => {
  const mockOriginal = jest.requireActual('../../src/utils/uuidv4')
  uuidv4Mock = jest.fn(() => `MOCK-ID-${counter++}`)
  return {
    __esModule: true,
    ...mockOriginal,
    uuidv4: uuidv4Mock,
  }
})
jest.mock('../../src/utils/logger')
jest.useFakeTimers().setSystemTime(new Date('2020-01-01').getTime())

describe('shadow-node-filter.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
    // Always uninstall to ensure clean state between tests
    if (isShadowNodeFilterInstalled()) {
      uninstallShadowNodeFilter()
    }
  })

  describe('Shadow node filter installation', () => {
    test('should install and uninstall shadow node filter', () => {
      expect(isShadowNodeFilterInstalled()).toBe(false)
      
      installShadowNodeFilter()
      expect(isShadowNodeFilterInstalled()).toBe(true)
      
      uninstallShadowNodeFilter()
      expect(isShadowNodeFilterInstalled()).toBe(false)
    })

    test('should not double-install shadow node filter', () => {
      installShadowNodeFilter()
      expect(isShadowNodeFilterInstalled()).toBe(true)
      
      // Second install should be a no-op
      installShadowNodeFilter()
      expect(isShadowNodeFilterInstalled()).toBe(true)
      
      uninstallShadowNodeFilter()
      expect(isShadowNodeFilterInstalled()).toBe(false)
    })
  })

  describe('Shadow node filtering', () => {
    test('should filter out shadow delete nodes from descendants traversal', () => {
      installShadowNodeFilter()

      // Create a document with a normal node and a shadow delete node
      const normalParagraph = schema.nodes.paragraph.create({
        id: 'normal-para'
      }, schema.text('Normal paragraph'))

      const shadowDeleteParagraph = schema.nodes.paragraph.create({
        id: 'shadow-para',
        dataTracked: [{
          id: 'change-1',
          operation: 'delete',
          moveNodeId: 'move-123',
          status: 'pending',
          authorID: 'user-1',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }]
      }, schema.text('Shadow delete paragraph'))

      const doc = schema.nodes.doc.create({}, [
        normalParagraph,
        shadowDeleteParagraph
      ])

      // Verify our nodes are set up correctly
      expect(isShadowDelete(normalParagraph)).toBe(false)
      expect(isShadowDelete(shadowDeleteParagraph)).toBe(true)
      expect(isNodeShadowFiltered(normalParagraph)).toBe(false)
      expect(isNodeShadowFiltered(shadowDeleteParagraph)).toBe(true)

      // Track which nodes are visited during traversal
      const visitedNodes: PMNode[] = []
      doc.descendants((node) => {
        visitedNodes.push(node)
      })

      // Should only see the normal paragraph and its text, not the shadow delete node
      expect(visitedNodes).toHaveLength(2) // normal paragraph + its text node
      expect(visitedNodes[0]).toBe(normalParagraph)
      expect(visitedNodes[1].text).toBe('Normal paragraph')
      
      // Should not see the shadow delete paragraph
      expect(visitedNodes.find(node => node === shadowDeleteParagraph)).toBeUndefined()
    })

    test('should filter out child nodes of shadow delete nodes', () => {
      installShadowNodeFilter()

      // Create a blockquote with child paragraph that's marked as shadow delete
      const childParagraph = schema.nodes.paragraph.create({
        id: 'child-para'
      }, schema.text('Child paragraph'))

      const shadowDeleteBlockquote = schema.nodes.blockquote.create({
        id: 'shadow-blockquote',
        dataTracked: [{
          id: 'change-1',
          operation: 'delete',
          moveNodeId: 'move-123',
          status: 'pending',
          authorID: 'user-1',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }]
      }, [childParagraph])

      const normalParagraph = schema.nodes.paragraph.create({
        id: 'normal-para'
      }, schema.text('Normal paragraph'))

      const doc = schema.nodes.doc.create({}, [
        shadowDeleteBlockquote,
        normalParagraph
      ])

      // Track visited nodes
      const visitedNodes: PMNode[] = []
      doc.descendants((node) => {
        visitedNodes.push(node)
      })

      // Should only see the normal paragraph and its text
      expect(visitedNodes).toHaveLength(2) // normal paragraph + its text
      expect(visitedNodes[0]).toBe(normalParagraph)
      expect(visitedNodes[1].text).toBe('Normal paragraph')
      
      // Should not see the shadow blockquote or its child paragraph
      expect(visitedNodes.find(node => node === shadowDeleteBlockquote)).toBeUndefined()
      expect(visitedNodes.find(node => node === childParagraph)).toBeUndefined()
    })

    test('should allow access to shadow nodes when filter is temporarily disabled', () => {
      installShadowNodeFilter()

      const shadowDeleteParagraph = schema.nodes.paragraph.create({
        id: 'shadow-para',
        dataTracked: [{
          id: 'change-1',
          operation: 'delete',
          moveNodeId: 'move-123',
          status: 'pending',
          authorID: 'user-1',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }]
      }, schema.text('Shadow delete paragraph'))

      const doc = schema.nodes.doc.create({}, [shadowDeleteParagraph])

      // With filter active, should not see shadow node
      let visitedNodes: PMNode[] = []
      doc.descendants((node) => {
        visitedNodes.push(node)
      })
      expect(visitedNodes).toHaveLength(0)

      // With filter temporarily disabled, should see shadow node
      visitedNodes = []
      withoutShadowFilter(() => {
        doc.descendants((node) => {
          visitedNodes.push(node)
        })
      })
      expect(visitedNodes).toHaveLength(2) // shadow paragraph + its text
      expect(visitedNodes[0]).toBe(shadowDeleteParagraph)

      // Filter should be re-enabled after callback
      visitedNodes = []
      doc.descendants((node) => {
        visitedNodes.push(node)
      })
      expect(visitedNodes).toHaveLength(0)
    })
  })

  test('should not filter non-shadow delete nodes', () => {
    installShadowNodeFilter()

    // Create nodes with different tracking operations
    const insertParagraph = schema.nodes.paragraph.create({
      id: 'insert-para',
      dataTracked: [{
        id: 'change-1',
        operation: 'insert',
        status: 'pending',
        authorID: 'user-1',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }]
    }, schema.text('Insert paragraph'))

    const regularDeleteParagraph = schema.nodes.paragraph.create({
      id: 'delete-para',
      dataTracked: [{
        id: 'change-2',
        operation: 'delete', // delete without moveNodeId = not shadow
        status: 'pending',
        authorID: 'user-1',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }]
    }, schema.text('Regular delete paragraph'))

    const doc = schema.nodes.doc.create({}, [
      insertParagraph,
      regularDeleteParagraph
    ])

    const visitedNodes: PMNode[] = []
    doc.descendants((node) => {
      visitedNodes.push(node)
    })

    // Should see both nodes and their text
    expect(visitedNodes).toHaveLength(4) // 2 paragraphs + 2 text nodes
    expect(visitedNodes.find(node => node === insertParagraph)).toBeDefined()
    expect(visitedNodes.find(node => node === regularDeleteParagraph)).toBeDefined()
  })
})