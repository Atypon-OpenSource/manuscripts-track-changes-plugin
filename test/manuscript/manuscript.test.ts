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
import { schema } from '@manuscripts/manuscript-transform'
import { Node as PMNode, Schema } from 'prosemirror-model'

import { promises as fs } from 'fs'

import { CHANGE_STATUS, trackChangesPluginKey, trackCommands, ChangeSet } from '../../src'
import docs from '../__fixtures__/docs'
import { SECOND_USER } from '../__fixtures__/users'
import { setupEditor } from '../utils/setupEditor'

import { log } from '../../src/utils/logger'
import manuscriptApplied from './manuscript-applied.json'

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

describe('manuscript.test', () => {
  afterEach(() => {
    counter = 0
    jest.clearAllMocks()
  })

  test('should correctly apply adjacent block changes', async () => {
    const tester = setupEditor({
      doc: docs.manuscriptSimple[0],
      schema: schema as unknown as Schema,
    })
      .insertNode(schema.nodes.table_element.createAndFill() as unknown as PMNode, 11)
      .insertNode(schema.nodes.figure_element.createAndFill() as unknown as PMNode, 11)
      .cmd((state, dispatch) => {
        const trackChangesState = trackChangesPluginKey.getState(state)
        if (!trackChangesState) {
          return
        }
        const { changeSet } = trackChangesState
        const change = changeSet.pending.find(
          (c) => c.type === 'node-change' && c.nodeType === 'figure_element'
        )
        if (change && ChangeSet.isNodeChange(change)) {
          const ids = [change.id]
          trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, ids)(state, dispatch)
        }
      })


    tester.cmd(trackCommands.applyAndRemoveChanges())

    // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))
    expect(tester.toJSON()).toEqual(manuscriptApplied[0])
    expect(uuidv4Mock.mock.calls.length).toBe(10)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
