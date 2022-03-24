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

import { schema as defaultSchema } from '@manuscripts/examples-track-schema'
import { promises as fs } from 'fs'

import {
  CHANGE_STATUS,
  setAction,
  TrackChangesAction,
  trackChangesPluginKey,
  trackCommands,
  ChangeSet,
} from '../src'
import docs from './__fixtures__/docs'
import { SECOND_USER } from './__fixtures__/users'
import { setupEditor } from './utils/setupEditor'

import { log } from '../src/utils/logger'

let counter = 0
// https://stackoverflow.com/questions/65554910/jest-referenceerror-cannot-access-before-initialization
// eslint-disable-next-line
var uuidv4Mock: jest.Mock

jest.mock('../src/utils/uuidv4', () => {
  const mockOriginal = jest.requireActual('../src/utils/uuidv4')
  uuidv4Mock = jest.fn(() => `MOCK-ID-${counter++}`)
  return {
    __esModule: true,
    ...mockOriginal,
    uuidv4: uuidv4Mock,
  }
})
jest.mock('../src/utils/logger')
jest.useFakeTimers().setSystemTime(new Date('2020-01-01').getTime())

describe('track changes', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should track inserts of paragraphs', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[0],
    }).insertNode(defaultSchema.nodes.paragraph.createAndFill(), 0)

    expect(tester.toJSON()).toEqual(docs.basicNodeInsert)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should prevent deletion of paragraphs unless already inserted', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[1],
    })
      .insertNode(defaultSchema.nodes.paragraph.create(), 0)
      .moveCursor('start')
      .insertText('inserted text')

    expect(tester.toJSON()).toEqual(docs.basicNodeDelete[0])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    tester.cmd((state, dispatch) => {
      const tr = state.tr
      tr.delete(0, state.doc.nodeSize - 2)
      dispatch && dispatch(tr)
      return true
    })
    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))
    // Contains paragraph insert since the default doc must have at least one child paragraph,
    // thus PM tries to automatically fill it when it's destroyed. However, in our case that's
    // not ideal but it's not fixed for now, since deleting the whole doc at once can't be done by user.
    expect(tester.toJSON()).toEqual(docs.basicNodeDelete[1])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(10)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should create insert & delete operations on inline node attribute change', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[0],
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
        const tr = state.tr
        tr.setNodeMarkup(1, undefined, {
          src: 'https://i.imgur.com/WdH20od.jpeg',
          title: 'Changed title',
        })
        dispatch && dispatch(tr)
        return true
      })

    expect(tester.toJSON()).toEqual(docs.inlineNodeAttrUpdate)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(3)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test.skip('should track node attribute updates', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[0],
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

    expect(tester.toJSON()).toEqual(docs.blockNodeAttrUpdate)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
