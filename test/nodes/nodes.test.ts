/*!
 * © 2022 Atypon Systems LLC
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
import { promises as fs } from 'fs'

import { CHANGE_STATUS, trackChangesPluginKey, trackCommands, ChangeSet } from '../../src'
import docs from '../__fixtures__/docs'
import { schema as defaultSchema, schema } from '../utils/schema'
import { setupEditor } from '../utils/setupEditor'

import { log } from '../../src/utils/logger'

import basicNodeDelete from './basic-node-del.json'
import basicNodeInsert from './basic-node-ins.json'
import blockNodeAttrUpdate from './block-node-attr-update.json'
import inlineNodeAttrUpdate from './inline-node-attr-update.json'
import wrapWithLink from './wrap-with-link.json'
import { NodeSelection } from 'prosemirror-state'

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

describe('nodes.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should track inserts of paragraphs', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    }).insertNode(defaultSchema.nodes.paragraph.createAndFill(), 0)

    expect(tester.toJSON()).toEqual(basicNodeInsert)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should prevent deletion of paragraphs unless already inserted', async () => {
    const tester = setupEditor({
      doc: docs.blockquoteMarks,
    })
      .insertNode(defaultSchema.nodes.paragraph.create(), 0)
      .moveCursor('start')
      .insertText('inserted text')

    expect(tester.toJSON()).toEqual(basicNodeDelete[0])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    tester.cmd((state, dispatch) => {
      dispatch(state.tr.delete(0, state.doc.nodeSize - 2))
    })
    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))
    // Contains paragraph insert since the default doc must have at least one child paragraph,
    // thus PM tries to automatically fill it when it's destroyed. However, in our case that's
    // not ideal but it's not fixed for now, since deleting the whole doc at once can't be done by user.
    expect(tester.toJSON()).toEqual(basicNodeDelete[1])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(10)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should create insert & delete operations on inline node attribute change', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .insertNode(
        defaultSchema.nodes.image.createAndFill({
          src: 'https://i.imgur.com/lFAxY.png',
          title: 'Image',
        }),
        1
      )
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return false
        }
        const { changeSet } = trackChangesState
        const ids = ChangeSet.flattenTreeToIds(changeSet.pending)
        trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(state, dispatch)
        return true
      })
      .cmd(trackCommands.applyAndRemoveChanges())
      .cmd((state, dispatch) => {
        dispatch(
          state.tr.setNodeMarkup(1, undefined, {
            src: 'https://i.imgur.com/WdH20od.jpeg',
            title: 'Changed title',
          })
        )
      })
    // await fs.writeFile('inline.json', JSON.stringify(tester.toJSON()))
    expect(tester.toJSON()).toEqual(inlineNodeAttrUpdate)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(3)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should correctly track only inserted link leaving its text content untouched', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .selectText(1, 6)
      .wrapInInline(schema.nodes.link)

    expect(tester.toJSON()).toEqual(wrapWithLink[0])

    tester.cmd((state, dispatch) => {
      dispatch(
        state.tr.setNodeMarkup(1, undefined, {
          href: 'https://testing.testing',
          title: 'I am a title',
        })
      )
    })

    expect(tester.toJSON()).toEqual(wrapWithLink[1])

    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(2)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should convert insert+delete block node into single update attr operation', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .insertNode(defaultSchema.nodes.equation_wrapper.createAndFill(), 1)
      .cmd((state, dispatch) => {
        dispatch(state.tr.setSelection(NodeSelection.create(state.doc, 3)))
      })
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return false
        }
        const { changeSet } = trackChangesState
        const ids = ChangeSet.flattenTreeToIds(changeSet.pending)
        trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(state, dispatch)
        return true
      })
      .cmd(trackCommands.applyAndRemoveChanges())

    expect(tester.toJSON()).toEqual(blockNodeAttrUpdate[0])

    tester.cmd((state, dispatch) => {
      dispatch(
        state.tr.setNodeMarkup(3, undefined, {
          TeXRepresentation: '1+1=2',
        })
      )
    })

    // await fs.writeFile('todo.json', JSON.stringify(tester.toJSON()))
    expect(tester.toJSON()).toEqual(blockNodeAttrUpdate[1])
  })

  test.skip('should track node attribute updates', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    }).cmd((state, dispatch) => {
      const cursor = state.selection.head
      const blockNodePos = state.doc.resolve(cursor).start(1) - 1
      if (
        state.doc.resolve(blockNodePos).nodeAfter?.type === state.schema.nodes.paragraph &&
        dispatch
      ) {
        dispatch(
          state.tr.setNodeMarkup(blockNodePos, undefined, {
            testAttribute: 'changed',
          })
        )
        return true
      }
      return false
    })

    await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(blockNodeAttrUpdate)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
