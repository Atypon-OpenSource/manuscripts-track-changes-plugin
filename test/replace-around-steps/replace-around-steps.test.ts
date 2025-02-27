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
import { promises as fs } from 'fs'
import { Fragment, Slice } from 'prosemirror-model'
import { liftTarget } from 'prosemirror-transform'

import { CHANGE_STATUS, ChangeSet, trackChangesPluginKey, trackCommands } from '../../src'
import { log } from '../../src/utils/logger'
import docs from '../__fixtures__/docs'
import { schema } from '../utils/schema'
import { setupEditor } from '../utils/setupEditor'
import replaceAroundSteps from './replace-around-steps.json'

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

describe('replace-around-steps.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should track basic wrapping and unwrapping of blockquotes', async () => {
    const tester = setupEditor({
      doc: docs.nestedBlockquotes,
    })
      // Wrap the 1st paragraph in a blockquote using a ReplaceAroundStep and then immediately delete it with
      // another ReplaceAroundStep. LiftNode in this case maps to pressing backspace inside the paragraph
      // which I could not programmatically trigger in jsdom
      .selectText(12, 14)
      .wrapIn(schema.nodes.blockquote)
      .liftnode(1)
      // As the backspace command isn't really a backspace, it doesn't really behave which should just lift the
      // inner most blockquote. However, executing .delete(14, 18) as we do here does make for an interesting test
      // case as this should unwrap the nested blockquote as well as its parent, so that accepting the changes
      // would join the 2nd paragraph with 1st paragraph.
      // .selectText(18)
      // .backspace(4)
      // Unwrap the innermost blockquote which should set it deleted but leave the content intact
      .liftnode(17)
      // This simulates pressing backspace inside 4th paragraph which should try to lift it inside the blockquote
      // .cmd((state, dispatch) => {
      //   const { tr, schema } = state
      //   const bq = schema.nodes.blockquote.create()
      //   // Or, more challenging?
      //   // const bq = schema.nodes.blockquote.create(undefined, schema.nodes.paragraph.create())
      //   const slice = new Slice(Fragment.from(bq), 1, 0)
      //   const step = new ReplaceAroundStep(48, 64, 49, 64, slice, 0, true)
      //   dispatch(tr.step(step))
      // })
      // Wrap the 4th paragraph in a blockquote and see whether track-changes-plugin correctly handles the positions
      // when adjacent to blockquote above and end of doc at the bottom
      .selectText(50)
      .wrapIn(schema.nodes.blockquote)

    // move at the start of 3rd paragraph, hit backspace -> should wrap inside the nested blockquote
    // same would happen with 4th paragraph
    // this not support in any way right now, it has to be retested when blockquotes wrapping/lifting is implemented in the editor
    // expect(tester.toJSON()).toEqual(replaceAroundSteps[0])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    // expect(tester.toJSON()).toEqual(replaceAroundSteps[1])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(7)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test.skip('should mark text inserted/deleted when selection spans various nodes', async () => {
    const tester = setupEditor({
      doc: docs.nestedBlockquotes,
    })
      .selectText(5, 21)
      .insertText('ab')
      .selectText(32, 48)
      .insertText('c')

    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    // expect(tester.toJSON()).toEqual(basicTextInconsistent[0])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(4)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('track multiple ReplaceAroundStep in the same transaction', async () => {
    setupEditor({
      doc: docs.list,
    })
      .selectText(26, 37)
      .cmd((state, dispatch) => {
        const { tr } = state
        state.doc.nodesBetween(22, 22 + (state.doc.nodeAt(22)?.nodeSize || 0), (node, pos) => {
          const $fromPos = tr.doc.resolve(tr.mapping.map(pos))
          const $toPos = tr.doc.resolve(tr.mapping.map(pos + node.nodeSize - 1))
          const nodeRange = $fromPos.blockRange($toPos)
          if (!nodeRange) {
            return
          }

          const targetLiftDepth = liftTarget(nodeRange)
          if (targetLiftDepth || targetLiftDepth === 0) {
            tr.lift(nodeRange, targetLiftDepth)
          }
        })
        dispatch(tr)
      })

    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test.skip('should track list indent', async () => {
    const tester = setupEditor({
      doc: docs.list,
    })
      .selectText(31)
      .sinkInList(schema)

    // TODO:: assert will be based on what we decided to do with Replaced Around step for open end slice,
    //        track it as insert/delete!
  })

  test.skip('should track undent list', async () => {
    const tester = setupEditor({
      doc: docs.list,
    })
      .selectText(9)
      .liftListItem(schema)

    // TODO:: assert will be based on what we decided to do with Replaced Around step for open end slice,
    //        track it as insert/delete!
  })

  test('should return back wrapped content on rejection', async () => {
    const tester = setupEditor({
      doc: docs.list,
    })
      .selectText(37, 44)
      .wrapIn(schema.nodes.bullet_list)

    const wrapWithNodeChange = tester
      .trackState()
      ?.changeSet.pending.find((change) => change.dataTracked.operation === 'wrap_with_node')
    expect(wrapWithNodeChange).not.toBeUndefined()

    tester.cmd((state, dispatch) => {
      if (wrapWithNodeChange) {
        trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, [wrapWithNodeChange.id])(state, dispatch)
      }
    })

    expect(tester.view.state.doc.slice(37, 44).content.textBetween(0, 9)).toEqual('123')

    expect(tester.trackState()?.changeSet?.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(2)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
