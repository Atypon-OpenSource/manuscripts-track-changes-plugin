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
/// <reference types="@types/jest" />;
import { promises as fs } from 'fs'

import { ChangeSet, trackChangesPluginKey, trackCommands } from '../../src'
import { CHANGE_OPERATION, CHANGE_STATUS } from '../../src/types/change'
import { log } from '../../src/utils/logger'
import docs from '../__fixtures__/docs'
import { setupEditor } from '../utils/setupEditor'

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

describe('marks.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should track adding bold mark to text', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    }).cmd((state, dispatch) => {
      const tr = state.tr
      const boldMark = state.schema.marks.bold.create()
      tr.addMark(1, 6, boldMark) // Add bold to "Hello"
      dispatch && dispatch(tr)
      return true
    })

    // Generate the fixture file to see what the actual output is
    // await fs.writeFile('./test/marks/add-bold-mark.json', JSON.stringify(tester.toJSON(), null, 2))

    const result = tester.toJSON()

    // Verify that the mark was tracked
    const textNode = result.doc.content[0].content[0] // First paragraph, first text node
    expect(textNode.marks).toHaveLength(1)
    expect(textNode.marks[0].type).toBe('bold')
    expect(textNode.marks[0].attrs.dataTracked).toHaveLength(1)
    expect(textNode.marks[0].attrs.dataTracked[0].operation).toBe(CHANGE_OPERATION.insert)
    expect(textNode.marks[0].attrs.dataTracked[0].id).toBe('MOCK-ID-0')
    expect(textNode.marks[0].attrs.dataTracked[0].authorID).toBe('1-mike')

    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should not track removing pending bold mark from text', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .cmd((state, dispatch) => {
        // First add bold mark
        const tr = state.tr
        const boldMark = state.schema.marks.bold.create()
        tr.addMark(1, 6, boldMark) // Add bold to "Hello"
        dispatch && dispatch(tr)
        return true
      })
      .cmd((state, dispatch) => {
        // Then remove bold mark
        const tr = state.tr
        const textNode = state.doc.nodeAt(1)
        if (textNode?.marks.length) {
          const boldMark = textNode.marks.find((m) => m.type.name === 'bold')
          if (boldMark) {
            tr.removeMark(1, 6, boldMark)
          }
        }
        dispatch && dispatch(tr)
        return true
      })

    // Generate the fixture file to see what the actual output is
    // await fs.writeFile(
    //   './test/marks/remove-bold-mark.json',
    //   JSON.stringify(tester.toJSON(), null, 2)
    // )

    const result = tester.toJSON()
    const textNode = result.doc.content[0].content[0]
    const sourceNode = docs.paragraph.content[0].content[0]

    // Should be equal it's original content since canceling pending mark should not be tracked and must result in removing the mark
    expect(textNode.text).toEqual(sourceNode.text)

    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(2) // One for add, one for remove
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should track removing bold mark from text', async () => {
    const tester = setupEditor({
      doc: docs.paragraph,
    })
      .cmd((state, dispatch) => {
        // First add bold mark
        const tr = state.tr
        const boldMark = state.schema.marks.bold.create()
        tr.addMark(1, 6, boldMark) // Add bold to "Hello"
        dispatch && dispatch(tr)
        return true
      })
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return false
        }
        const ids = ChangeSet.flattenTreeToIds(trackChangesState.changeSet.pending)
        trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(state, dispatch)
        return true
      })
      .cmd((state, dispatch) => {
        // Then remove bold mark
        const tr = state.tr
        const textNode = state.doc.nodeAt(1)
        if (textNode?.marks.length) {
          const boldMark = textNode.marks.find((m) => m.type.name === 'bold')
          if (boldMark) {
            tr.removeMark(1, 6, boldMark)
          }
        }
        dispatch && dispatch(tr)
        return true
      })

    // Generate the fixture file to see what the actual output is
    // await fs.writeFile(
    //   './test/marks/remove-bold-mark.json',
    //   JSON.stringify(tester.toJSON(), null, 2)
    // )

    const result = tester.toJSON()

    // Verify that the mark was tracked
    const textNode = result.doc.content[0].content[0] // First paragraph, first text node
    expect(textNode.marks).toHaveLength(1)
    expect(textNode.marks[0].type).toBe('bold')
    expect(textNode.marks[0].attrs.dataTracked).toHaveLength(1)
    expect(textNode.marks[0].attrs.dataTracked[0].operation).toBe(CHANGE_OPERATION.delete)
    expect(textNode.marks[0].attrs.dataTracked[0].id).toBe('MOCK-ID-1')
    expect(textNode.marks[0].attrs.dataTracked[0].authorID).toBe('1-mike')

    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(2)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
