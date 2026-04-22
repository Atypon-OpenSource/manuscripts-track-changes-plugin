/*!
 * © 2025 Atypon Systems LLC
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
import { type Mock } from 'vitest'

import { Fragment, Slice } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'

import { clearShadowsFromNewlyInserted } from '../../src/tracking/transactionProcessing'
import { isShadowDelete } from '../../src/tracking/steps-trackers/qualifiers'
import { log } from '../../src/utils/logger'
import { schema } from '../utils/schema'

let counter = 0
// https://stackoverflow.com/questions/65554910/jest-referenceerror-cannot-access-before-initialization
// eslint-disable-next-line
var uuidv4Mock: Mock

vi.mock('../../src/utils/uuidv4', async (importOriginal) => {
  const mockOriginal = await importOriginal<typeof import('../../src/utils/uuidv4')>()
  uuidv4Mock = vi.fn(() => `MOCK-ID-${counter++}`)
  return {
    ...mockOriginal,
    uuidv4: uuidv4Mock,
  }
})
vi.mock('../../src/utils/logger')
vi.useFakeTimers()
vi.setSystemTime(new Date('2020-01-01'))

describe('remove-shadows.test', () => {
  afterEach(() => {
    counter = 0
    vi.clearAllMocks()
  })

  describe('clearShadowsFromNewlyInserted', () => {
    test('should filter out shadow delete nodes from inserted content', () => {
      // Create a document with a paragraph
      const initialDoc = schema.nodes.doc.create({}, [
        schema.nodes.paragraph.create({}, schema.text('Initial content')),
      ])

      const baseState = EditorState.create({ doc: initialDoc })

      // Create a shadow delete paragraph (delete operation with moveNodeId = shadow)
      const shadowDeleteParagraph = schema.nodes.paragraph.create(
        {
          dataTracked: [
            {
              id: 'shadow-change-1',
              operation: 'delete',
              moveNodeId: 'move-123', // This makes it a shadow delete
              status: 'pending',
              authorID: 'user-1',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
        schema.text('Shadow content that should be filtered')
      )

      // Create a normal paragraph
      const normalParagraph = schema.nodes.paragraph.create({}, schema.text('Normal content'))

      // Verify our test node is actually a shadow delete
      expect(isShadowDelete(shadowDeleteParagraph)).toBe(true)
      expect(isShadowDelete(normalParagraph)).toBe(false)

      // Create a transaction that inserts both paragraphs
      const tr = baseState.tr
      const slice = new Slice(Fragment.from([shadowDeleteParagraph, normalParagraph]), 0, 0)
      tr.step(new ReplaceStep(17, 17, slice)) // Insert at end of doc

      // Apply shadow filtering
      const filteredTr = clearShadowsFromNewlyInserted(tr, baseState)

      // The filtered transaction should have a step
      expect(filteredTr.steps.length).toBe(1)

      // Get the filtered step and check its content
      const filteredStep = filteredTr.steps[0] as ReplaceStep
      expect(filteredStep).toBeInstanceOf(ReplaceStep)

      // The filtered content should only have the normal paragraph, not the shadow delete
      expect(filteredStep.slice.content.childCount).toBe(1)
      expect(filteredStep.slice.content.firstChild?.textContent).toBe('Normal content')

      // Verify shadow content was removed
      let foundShadow = false
      filteredStep.slice.content.descendants((node) => {
        if (isShadowDelete(node)) {
          foundShadow = true
        }
      })
      expect(foundShadow).toBe(false)

      expect(log.warn).toHaveBeenCalledTimes(0)
      expect(log.error).toHaveBeenCalledTimes(0)
    })

    test('should filter out nested shadow delete nodes from within parent nodes', () => {
      // Create a document with a blockquote
      const initialDoc = schema.nodes.doc.create({}, [
        schema.nodes.paragraph.create({}, schema.text('Initial content')),
      ])

      const baseState = EditorState.create({ doc: initialDoc })

      // Create a shadow delete paragraph nested inside a blockquote
      const shadowDeleteParagraph = schema.nodes.paragraph.create(
        {
          dataTracked: [
            {
              id: 'shadow-change-nested',
              operation: 'delete',
              moveNodeId: 'move-nested-123',
              status: 'pending',
              authorID: 'user-1',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
        schema.text('Nested shadow content')
      )

      const normalParagraph = schema.nodes.paragraph.create({}, schema.text('Normal nested content'))

      // Create a blockquote containing both a shadow delete and normal paragraph
      const blockquoteWithShadow = schema.nodes.blockquote.create({}, [
        shadowDeleteParagraph,
        normalParagraph,
      ])

      // Verify our setup
      expect(isShadowDelete(shadowDeleteParagraph)).toBe(true)
      expect(isShadowDelete(normalParagraph)).toBe(false)
      expect(isShadowDelete(blockquoteWithShadow)).toBe(false)

      // Create a transaction that inserts the blockquote with nested shadow content
      const tr = baseState.tr
      const slice = new Slice(Fragment.from([blockquoteWithShadow]), 0, 0)
      tr.step(new ReplaceStep(17, 17, slice))

      // Apply shadow filtering
      const filteredTr = clearShadowsFromNewlyInserted(tr, baseState)

      // The filtered transaction should have a step
      expect(filteredTr.steps.length).toBe(1)

      const filteredStep = filteredTr.steps[0] as ReplaceStep
      expect(filteredStep).toBeInstanceOf(ReplaceStep)

      // The blockquote should still exist, but without the shadow delete paragraph
      expect(filteredStep.slice.content.childCount).toBe(1)
      const filteredBlockquote = filteredStep.slice.content.firstChild
      expect(filteredBlockquote?.type.name).toBe('blockquote')

      // The blockquote should only contain the normal paragraph now
      expect(filteredBlockquote?.content.childCount).toBe(1)
      expect(filteredBlockquote?.content.firstChild?.textContent).toBe('Normal nested content')

      // Verify no shadow content exists anywhere in the tree
      let foundShadow = false
      filteredStep.slice.content.descendants((node) => {
        if (isShadowDelete(node)) {
          foundShadow = true
        }
      })
      expect(foundShadow).toBe(false)

      expect(log.warn).toHaveBeenCalledTimes(0)
      expect(log.error).toHaveBeenCalledTimes(0)
    })

    test('should NOT filter out regular delete nodes (without moveNodeId)', () => {
      // Create a document
      const initialDoc = schema.nodes.doc.create({}, [
        schema.nodes.paragraph.create({}, schema.text('Initial content')),
      ])

      const baseState = EditorState.create({ doc: initialDoc })

      // Create a REGULAR delete paragraph (delete operation WITHOUT moveNodeId - not a shadow)
      const regularDeleteParagraph = schema.nodes.paragraph.create(
        {
          dataTracked: [
            {
              id: 'regular-delete-change',
              operation: 'delete',
              // Note: NO moveNodeId - this is a regular delete, not a shadow delete
              status: 'pending',
              authorID: 'user-1',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
        schema.text('Regular deleted content - should remain')
      )

      // Create an insert paragraph
      const insertParagraph = schema.nodes.paragraph.create(
        {
          dataTracked: [
            {
              id: 'insert-change',
              operation: 'insert',
              status: 'pending',
              authorID: 'user-1',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
        schema.text('Inserted content')
      )

      // Create a plain paragraph
      const plainParagraph = schema.nodes.paragraph.create({}, schema.text('Plain content'))

      // Verify our test nodes are set up correctly
      expect(isShadowDelete(regularDeleteParagraph)).toBe(false) // NOT a shadow delete
      expect(isShadowDelete(insertParagraph)).toBe(false)
      expect(isShadowDelete(plainParagraph)).toBe(false)

      // Create a transaction that inserts all three paragraphs
      const tr = baseState.tr
      const slice = new Slice(
        Fragment.from([regularDeleteParagraph, insertParagraph, plainParagraph]),
        0,
        0
      )
      tr.step(new ReplaceStep(17, 17, slice))

      // Apply shadow filtering
      const filteredTr = clearShadowsFromNewlyInserted(tr, baseState)

      // The filtered transaction should have a step
      expect(filteredTr.steps.length).toBe(1)

      const filteredStep = filteredTr.steps[0] as ReplaceStep
      expect(filteredStep).toBeInstanceOf(ReplaceStep)

      // ALL THREE paragraphs should remain since none are shadow deletes
      expect(filteredStep.slice.content.childCount).toBe(3)

      // Verify all content is present
      const texts: string[] = []
      filteredStep.slice.content.forEach((node) => {
        texts.push(node.textContent)
      })

      expect(texts).toContain('Regular deleted content - should remain')
      expect(texts).toContain('Inserted content')
      expect(texts).toContain('Plain content')

      expect(log.warn).toHaveBeenCalledTimes(0)
      expect(log.error).toHaveBeenCalledTimes(0)
    })
  })
})
