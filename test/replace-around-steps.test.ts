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

import { trackCommands } from '../src'
import docs from './__fixtures__/docs'
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

  test('should track basic wrapping and unwrapping of blockquotes', async () => {
    const tester = setupEditor({
      doc: docs.defaultDocs[2],
    })
      // Wrap the 1st paragraph in a blockquote using a ReplaceAroundStep and then immediately delete it with
      // another ReplaceAroundStep. LiftNode in this case maps to pressing backspace inside the paragraph
      // which I could not programmatically trigger in jsdom
      .selectText(12, 14)
      .wrapIn(defaultSchema.nodes.blockquote)
      .liftnode(1)
      // As the backspace command isn't really a backspace, it doesn't really behave which should just lift the
      // inner most blockquote. However, executing .delete(14, 18) as we do here does make for an interesting test
      // case as this should unwrap the nested blockquote as well as its parent, so that accepting the changes
      // would join the 2nd paragraph with 1st paragraph.
      // .selectText(18)
      // .backspace(4)
      // Unwrap the innermost blockquote which should set it deleted but leave the content intact
      .liftnode(17)
      // Wrap the 4th paragraph in a blockquote and see whether track-changes-plugin correctly handles the positions
      // when adjacent to blockquote above and end of doc at the bottom
      .selectText(50)
      .wrapIn(defaultSchema.nodes.blockquote)

    // move at the start of 3rd paragraph, hit backspace -> should wrap inside the nested blockquote
    // same would happen with 4th paragraph

    expect(tester.toJSON()).toEqual(docs.replaceAroundSteps[0])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)

    tester
      .setChangeStatuses()
      // TODO this deletes 2nd paragraph even though it wasn't deleted -> unwrap it instead
      .cmd(trackCommands.applyAndRemoveChanges())

    await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

    expect(tester.toJSON()).toEqual(docs.replaceAroundSteps[1])
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(uuidv4Mock.mock.calls.length).toBe(3)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
