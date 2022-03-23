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

import { setAction, TrackChangesAction, trackCommands } from '../src'
import docs from './__fixtures__/docs'
import { SECOND_USER } from './__fixtures__/users'
import * as utils from './utils/nodeUtils'
import { setupEditor } from './utils/setupEditor'
import { Fragment, Slice } from 'prosemirror-model'

let counter = 0
// https://stackoverflow.com/questions/65554910/jest-referenceerror-cannot-access-before-initialization
// eslint-disable-next-line
var uuidv4Mock: jest.Mock, logWarns: jest.Mock, logErrors: jest.Mock

jest.mock('../src/utils/uuidv4', () => {
  const mockOriginal = jest.requireActual('../src/utils/uuidv4')
  uuidv4Mock = jest.fn(() => `MOCK-ID-${counter++}`)
  return {
    __esModule: true,
    ...mockOriginal,
    uuidv4: uuidv4Mock,
  }
})
jest.mock('../src/utils/logger', () => {
  const logOriginal = jest.requireActual('../src/utils/logger')
  logWarns = jest.fn()
  logErrors = jest.fn()
  return {
    __esModule: true,
    ...logOriginal,
    log: {
      info() {},
      warn: logWarns,
      error: logErrors,
    },
  }
})

jest.useFakeTimers().setSystemTime(new Date('2020-01-01').getTime())

describe('track changes', () => {
  afterEach(() => {
    expect(logWarns.mock.calls.length).toBe(0)
    expect(logErrors.mock.calls.length).toBe(0)

    counter = 0
    uuidv4Mock.mockClear()
    logWarns.mockClear()
    logErrors.mockClear()
  })

  test('should correctly wrap copy-pasted slice with track markup', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[2],
    })
      .paste(new Slice(Fragment.from(defaultSchema.text('inserted')), 0, 0), 18, 18)
      .paste(new Slice(Fragment.from(defaultSchema.text('replaced')), 0, 0), 5, 14)

    expect(tester.toJSON()).toEqual(docs.variousOpenEndedSlices[0])
    expect(tester.trackState()?.changeSet.hasDuplicateIds).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(3)
  })

  test('should prevent replacing of blockquotes and break the slice into parts instead', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[2],
    })
      .paste(
        new Slice(
          Fragment.from(utils.createBlockquote(defaultSchema, 'open-end blockquote')),
          0,
          2
        ),
        0,
        17
      )
      .paste(
        new Slice(
          Fragment.from(utils.createBlockquote(defaultSchema, 'open-start blockquote')),
          2,
          1
        ),
        55,
        74
      )

    expect(tester.toJSON()).toEqual(docs.variousOpenEndedSlices[1])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(7)
  })

  test.skip('asdf', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[2],
    }).paste(
      new Slice(
        Fragment.from(utils.createBlockquote(defaultSchema, 'delete inside blockquote')),
        2,
        0
      ),
      18,
      48
    )
    // .paste(new Slice(Fragment.from(utils.createBlockquote(defaultSchema, 'open-start blockquote')), 2, 1), 55, 74)

    await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(docs.variousOpenEndedSlices[1])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(7)
  })

  test.skip('todo bugs', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[2],
    })
      // Should delete 2nd and 3rd paragraph and replace the inner blockquote with this
      .paste(
        new Slice(
          Fragment.from(utils.createBlockquote(defaultSchema, 'delete inside blockquote')),
          1,
          1
        ),
        16,
        50
      )

    await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    // expect(tester.toJSON()).toEqual(docs.variousOpenEndedSlices[2])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(7)
  })
})
