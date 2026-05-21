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
import { Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'

import { normalizeShadowIds, SHADOW_ID_PREFIX } from '../../src/tracking/normalizeShadowIds'
import { isMoved, isShadowDelete } from '../../src/tracking/steps-trackers/qualifiers'
import { schema } from '../utils/schema'

vi.useFakeTimers()
vi.setSystemTime(new Date('2020-01-01'))

describe('shadow-ids.test', () => {
  test('should prefix IDs with ' + SHADOW_ID_PREFIX + ' for nodes inside shadow/moved context', () => {
    // Create a document with a shadow delete node containing a child with ID
    const shadowDeleteAttrs = {
      dataTracked: [
        {
          id: 'change-1',
          operation: 'delete',
          moveNodeId: 'move-123', // This makes it a shadow delete
          status: 'pending',
          authorID: 'user-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }

    // Create equation_wrapper (has id attr) marked as shadow delete, with equation child (also has id)
    const shadowWrapper = schema.nodes.equation_wrapper.create(
      {
        id: 'eq-wrapper-1',
        class: 'equation-wrapper',
        ...shadowDeleteAttrs,
      },
      [
        schema.nodes.equation.create({
          id: 'eq-1',
          class: 'equation',
          TeXRepresentation: 'E=mc^2',
          dataTracked: null,
        }),
        schema.nodes.figcaption.create({ dataTracked: null }),
      ]
    )
    const normalParagraph = schema.nodes.paragraph.create(
      { dataTracked: null, testAttribute: null },
      schema.text('Normal content')
    )

    // Build the document
    const doc = schema.nodes.doc.create({}, [normalParagraph, shadowWrapper])

    // Verify setup: shadowWrapper should be detected as shadow
    expect(isShadowDelete(shadowWrapper)).toBe(true)
    expect(isShadowDelete(normalParagraph)).toBe(false)

    // Create editor state and transaction
    const state = EditorState.create({ doc })
    const tr = state.tr

    // Apply normalizeShadowIds
    const normalizedTr = normalizeShadowIds(tr)

    // Verify: shadow nodes should have prefixed IDs
    let foundPrefixedWrapper = false
    let foundPrefixedEquation = false

    normalizedTr.doc.descendants((node: PMNode) => {
      if (node.type.name === 'equation_wrapper' && node.attrs.id === `${SHADOW_ID_PREFIX}eq-wrapper-1`) {
        foundPrefixedWrapper = true
      }
      if (node.type.name === 'equation' && node.attrs.id === `${SHADOW_ID_PREFIX}eq-1`) {
        foundPrefixedEquation = true
      }
      return true
    })

    expect(foundPrefixedWrapper).toBe(true)
    expect(foundPrefixedEquation).toBe(true)
  })

  test(
    'should remove ' + SHADOW_ID_PREFIX + ' prefix from IDs when nodes are no longer in shadow context',
    () => {
      // Create a document where nodes have SHADOW_ID_PREFIX prefix but are NOT in shadow context
      // This simulates what happens after a move change is rejected

      // Create equation_wrapper with SHADOW_ID_PREFIX prefixed ID but NO shadow tracking
      const equationWithPrefix = schema.nodes.equation.create({
        id: SHADOW_ID_PREFIX + 'eq-1', // Has prefix
        class: 'equation',
        TeXRepresentation: 'E=mc^2',
        dataTracked: null, // No shadow tracking
      })

      const figcaption = schema.nodes.figcaption.create({ dataTracked: null })
      const wrapperWithPrefix = schema.nodes.equation_wrapper.create(
        {
          id: `${SHADOW_ID_PREFIX}eq-wrapper-1`, // Has prefix
          class: 'equation-wrapper',
        },
        [equationWithPrefix, figcaption]
      )

      // Normal paragraph
      const normalParagraph = schema.nodes.paragraph.create(schema.text('Normal content'))

      // Build the document
      const doc = schema.nodes.doc.create({}, [normalParagraph, wrapperWithPrefix])

      // Verify setup: these nodes are NOT shadow (no tracking data with moveNodeId)
      expect(isShadowDelete(wrapperWithPrefix)).toBe(false)
      expect(isMoved(wrapperWithPrefix)).toBe(false)

      // Create editor state and transaction
      const state = EditorState.create({ doc })
      const tr = state.tr

      // Apply normalizeShadowIds
      const normalizedTr = normalizeShadowIds(tr)

      // Verify: non-shadow nodes should have prefix removed
      let foundUnprefixedWrapper = false
      let foundUnprefixedEquation = false

      normalizedTr.doc.descendants((node: PMNode) => {
        if (node.type.name === 'equation_wrapper' && node.attrs.id === 'eq-wrapper-1') {
          foundUnprefixedWrapper = true
        }
        if (node.type.name === 'equation' && node.attrs.id === 'eq-1') {
          foundUnprefixedEquation = true
        }
        return true
      })

      expect(foundUnprefixedWrapper).toBe(true)
      expect(foundUnprefixedEquation).toBe(true)
    }
  )
})
