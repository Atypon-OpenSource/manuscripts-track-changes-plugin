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
import { Fragment, Node as PMNode, Schema, Slice } from 'prosemirror-model'
import { undo } from 'prosemirror-history'

import { promises as fs } from 'fs'

import { CHANGE_STATUS, trackChangesPluginKey, trackCommands, ChangeSet } from '../../src'
import docs from '../__fixtures__/docs'
import { SECOND_USER } from '../__fixtures__/users'
import { schema } from '../utils/schema'
import { setupEditor } from '../utils/setupEditor'

import { log } from '../../src/utils/logger'
import textDiff from './text-diff.json'

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

describe('diff.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should diff text starting from the start of the deleted range', async () => {
    const tester = setupEditor({
      doc: docs.paragraphsMarksOldDeleted[0],
      schema: schema as unknown as Schema,
    }).paste(
      // Replace 'This is a partial' with 'This is a partial'
      new Slice(Fragment.from([schema.text('This is a partial')]), 0, 0),
      1,
      18
    )
    // The doc should stay the same as the text content being replace is equal
    expect(tester.toJSON()).toEqual(textDiff[0])

    // Replace 'partially' with 'partially'
    tester.paste(
      new Slice(
        Fragment.from([
          schema.text('partial'),
          schema.text('ly', [
            schema.marks.tracked_delete.create({
              createdAt: 1661509955426,
              id: '0767eaed-b7bb-4f72-8842-9f707ef46473',
              status: 'rejected',
              userID: null,
            }),
          ]),
        ]),
        0,
        0
      ),
      11,
      20
    )
    expect(tester.toJSON()).toEqual(textDiff[1])

    tester.cmd(undo).paste(
      // Replace 'ally' with 'partially'
      new Slice(
        Fragment.from([
          schema.text('partial'),
          schema.text('ly', [
            schema.marks.tracked_delete.create({
              createdAt: 1661509955426,
              id: '0767eaed-b7bb-4f72-8842-9f707ef46473',
              status: 'rejected',
              userID: null,
            }),
          ]),
        ]),
        0,
        0
      ),
      16,
      20
    )
    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(textDiff[2])
    expect(uuidv4Mock.mock.calls.length).toBe(6)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })

  // test('should diff text starting from the start of the deleted range', async () => {

  // })
})
