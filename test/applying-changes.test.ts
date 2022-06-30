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
import { schema as defaultSchema } from './utils/schema'
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

  test('should update marks/attributes status correctly', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[0],
    })
      .insertNode(defaultSchema.nodes.paragraph.createAndFill(), 0)
      .moveCursor('start')
      .insertText('before image')
      .insertMark(defaultSchema.marks.bold.create(), 1, 1 + 'before'.length)
      .insertNode(
        defaultSchema.nodes.image.createAndFill({
          src: 'https://i.imgur.com/lFAxY.png',
          title: 'Image',
        }),
        1 + 'before image'.length
      )
      .insertText('after image')
      .insertNode(defaultSchema.nodes.blockquote.createAndFill(), 0)
      .moveCursor('start')
      .insertText('quoted text')
      .insertNode(defaultSchema.nodes.heading.createAndFill({ level: 2 }), 0)
      .moveCursor('start')
      .insertText('header text')
      .insertNode(defaultSchema.nodes.horizontal_rule.createAndFill(), 0)
      .insertNode(defaultSchema.nodes.code_block.createAndFill(), 0)
      .moveCursor('start')
      .insertText('code text')
      .insertNode(defaultSchema.nodes.hard_break.createAndFill(), 0)
      .insertNode(defaultSchema.nodes.ordered_list.createAndFill(), 0)
      .moveCursor('start')
      .insertText('ordered list text')
      .insertNode(defaultSchema.nodes.table.createAndFill(), 0)
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

    expect(tester.toJSON()).toEqual(docs.insertAccept[0])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    tester.cmd(trackCommands.applyAndRemoveChanges())

    expect(tester.toJSON()).toEqual(docs.insertAccept[1])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should correctly apply adjacent block changes', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[2],
    })
      .insertNode(defaultSchema.nodes.ordered_list.createAndFill(), 0)
      .insertNode(defaultSchema.nodes.table.createAndFill(), 0)
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return
        }
        const { changeSet } = trackChangesState
        const change = changeSet.pending.find(
          (c) => c.type === 'node-change' && c.nodeType === 'table'
        )
        if (change && ChangeSet.isNodeChange(change)) {
          // const ids = [change.id, ...change.children.map(c => c.id)]
          const ids = [change.id]
          trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, ids)(state, dispatch)
        }
      })

    tester.cmd(trackCommands.applyAndRemoveChanges())

    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(docs.insertReject[0])
    expect(uuidv4Mock.mock.calls.length).toBe(11)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test.skip('should apply changes correctly', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[2],
    })

    expect(tester.toJSON()).toEqual(docs.insertAccept[0])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    tester.cmd(trackCommands.applyAndRemoveChanges())

    expect(tester.toJSON()).toEqual(docs.insertAccept[1])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
  })
})
