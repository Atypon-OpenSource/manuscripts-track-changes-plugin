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

import { setAction, TrackChangesAction, trackCommands } from '../src'
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

  test('should track basic text inserts', async () => {
    const tester = setupEditor({
      doc: docs.startingDocs.paragraph,
    }).insertText('inserted text')

    expect(tester.toJSON()).toEqual(docs.basicTextInsert)
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should track basic text inserts and deletes', async () => {
    const tester = setupEditor({
      doc: docs.startingDocs.paragraph,
    })
      .insertText('inserted text')
      .backspace(4)
      .moveCursor(5)
      .backspace(4)

    expect(tester.toJSON()).toEqual(docs.basicTextDelete)
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(2)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test.skip('should correctly delete content when backspace is pressed repeatedly', async () => {
    const tester = setupEditor({
      doc: docs.startingDocs.paragraph,
    }).insertText('inserted text')

    expect(tester.toJSON()).toEqual(docs.basicTextInsert)
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should join adjacent text inserts and deletes by same user', async () => {
    // delete first user inserts
    // delete at first user deletes -> should not replace marks
    // check inserts joined, deletes still separate
    // MISSING: check timestamps merged correctly
    const tester = setupEditor({
      doc: docs.startingDocs.paragraph,
    })
      .insertText('a')
      .insertText('b')
      .moveCursor('end')
      .backspace(1)
      .backspace(1)
      .insertText('c')

    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(docs.basicTextJoin[0])
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(4)

    tester
      .cmd(trackCommands.setUserID(SECOND_USER.id))
      .moveCursor('start')
      .insertText('d')
      .insertText('e')
      .moveCursor(2)
      .insertText('f')
      .insertText('g')
      .moveCursor(-2)
      .backspace(2) // Delete Mike's insertions to see that Rebecca's insertions are joined
      .moveCursor('end')
      .insertText('h')
      .moveCursor(-2)
      .backspace(1) // Overwrites Mike's deletion of 'l' TODO -> disallow? keep original deleter
      .backspace(1) // Deletes Mike's inserted 'c'
      .backspace(1) // Regular deletion of 'r'

    expect(tester.toJSON()).toEqual(docs.basicTextJoin[1])
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(10)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  test('should fix inconsistent text inserts and deletes', async () => {
    const tester = setupEditor({
      doc: docs.startingDocs.paragraph,
    })
      .insertText('abcd')
      .cmd((state, dispatch) => {
        const tr = state.tr
        const pos = 1
        const oldMarkAttrs = state.doc.resolve(pos + 1).marks()[0].attrs
        tr.removeMark(pos, pos + 1)
        tr.addMark(
          pos + 1,
          pos + 2,
          state.schema.marks.tracked_delete.create({
            dataTracked: {
              id: oldMarkAttrs.dataTracked.id,
            },
          })
        )
        tr.addMark(
          pos + 2,
          pos + 3,
          state.schema.marks.tracked_insert.create({
            dataTracked: {},
          })
        )
        setAction(tr, TrackChangesAction.skipTrack, true)
        dispatch && dispatch(tr)
        return true
      })

    // Check the insert mark was overwritten and the data is now inconsistent
    expect(tester.toJSON()).toEqual(docs.basicTextInconsistent[0])
    // Should contain one duplicate id
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(true)
    expect(tester.trackState()?.changeSet.hasIncompleteAttrs).toEqual(true)
    expect(uuidv4Mock.mock.calls.length).toBe(1)

    // TODO should not need moveCursor(0)
    tester.moveCursor(0).insertText('e').moveCursor(-4).backspace()

    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))
    expect(tester.toJSON()).toEqual(docs.basicTextInconsistent[1])
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(tester.trackState()?.changeSet.hasIncompleteAttrs).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(4)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
