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
import { schema as manuscriptSchema } from '@manuscripts/transform'
import { promises as fs } from 'fs'
import { baseKeymap } from 'prosemirror-commands'

import { CHANGE_STATUS, ChangeSet, trackChangesPluginKey, trackCommands } from '../../src'
import { log } from '../../src/utils/logger'
import docs from '../__fixtures__/docs'
import { SECOND_USER } from '../__fixtures__/users'
import { schema } from '../utils/schema'
import { setupEditor } from '../utils/setupEditor'
import insertAccept from './insert-accept.json'
import insertReject from './insert-reject.json'

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

describe('apply-changes.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should update marks/attributes status correctly', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .insertNode(schema.nodes.paragraph.createAndFill(), 0)
      .moveCursor('start')
      .insertText('before image')
      .insertMark(schema.marks.bold.create(), 1, 1 + 'before'.length)
      .insertNode(
        schema.nodes.image.createAndFill({
          src: 'https://i.imgur.com/lFAxY.png',
          title: 'Image',
        }),
        1 + 'before image'.length
      )
      .insertText('after image')
      .insertNode(schema.nodes.blockquote.createAndFill(), 0)
      .moveCursor('start')
      .insertText('quoted text')
      .insertNode(schema.nodes.heading.createAndFill({ level: 2 }), 0)
      .moveCursor('start')
      .insertText('header text')
      .insertNode(schema.nodes.horizontal_rule.createAndFill(), 0)
      .insertNode(schema.nodes.code_block.createAndFill(), 0)
      .moveCursor('start')
      .insertText('code text')
      .insertNode(schema.nodes.hard_break.createAndFill(), 0)
      .insertNode(schema.nodes.ordered_list.createAndFill(), 0)
      .moveCursor('start')
      .insertText('ordered list text')
      .insertNode(schema.nodes.table.createAndFill(), 0)
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

    expect(tester.toJSON()).toEqual(insertAccept[0])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    if (tester.trackState()?.changeSet.changes) {
      tester.cmd(
        trackCommands.setChangeStatuses(
          CHANGE_STATUS.accepted,
          tester.trackState()!.changeSet.changes.map((c) => c.id)
        )
      )
    }

    expect(tester.toJSON()).toEqual(insertAccept[1])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should correctly apply adjacent block changes', async () => {
    const tester = setupEditor({
      doc: docs.nestedBlockquotes,
    })
      .insertNode(schema.nodes.ordered_list.createAndFill(), 0)
      .insertNode(schema.nodes.table.createAndFill(), 0)
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return
        }
        const { changeSet } = trackChangesState
        const change = changeSet.pending.find((c) => c.type === 'node-change' && c.node.type.name === 'table')
        if (change && ChangeSet.isNodeChange(change)) {
          // const ids = [change.id, ...change.children.map(c => c.id)]
          const ids = [change.id]
          trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, ids)(state, dispatch)
        }
      })

    if (tester.trackState()?.changeSet.changes) {
      tester.cmd(
        trackCommands.setChangeStatuses(
          CHANGE_STATUS.accepted,
          tester.trackState()!.changeSet.changes.map((c) => c.id)
        )
      )
    }

    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(insertReject[0])
    expect(uuidv4Mock.mock.calls.length).toBe(11)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should apply deleting and set attribute for both contributor & affiliation', async () => {
    const tester = setupEditor({
      schema: manuscriptSchema,
      doc: docs.contributorsAndAffiliation,
    }).cmd((state, dispatch) => {
      const trackChangesState = trackChangesPluginKey.getState(state)
      if (!trackChangesState) {
        return false
      }
      const ids = ChangeSet.flattenTreeToIds(trackChangesState.changeSet.pending)
      trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(state, dispatch)
      return true
    })

    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    expect(uuidv4Mock.mock.calls.length).toBe(0)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test.skip('should apply changes correctly', async () => {
    const tester = setupEditor({
      doc: docs.nestedBlockquotes,
    })

    expect(tester.toJSON()).toEqual(insertAccept[0])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    expect(tester.toJSON()).toEqual(insertAccept[1])
    expect(uuidv4Mock.mock.calls.length).toBe(26)
  })

  test('should delete reference change', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .selectText(7)
      .cmd(baseKeymap['Enter'])

    tester.cmd((state, dispatch) => {
      const nodeSplitChange = tester
        .trackState()
        ?.changeSet?.pending.find((change) => change.dataTracked.operation === 'node_split')
      if (nodeSplitChange) {
        trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, [nodeSplitChange.id])(state, dispatch)
      }
    })

    expect(tester.trackState()?.changeSet.changes.length).toEqual(0)
  })
})
