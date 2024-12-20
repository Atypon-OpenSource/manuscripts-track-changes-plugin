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
import fs from 'fs'
import { undo } from 'prosemirror-history'
import { Fragment, Node as PMNode, Schema, Slice } from 'prosemirror-model'

import { CHANGE_STATUS, ChangeSet, trackChangesPluginKey, trackCommands } from '../../src'
import { log } from '../../src/utils/logger'
import docs from '../__fixtures__/docs'
import { SECOND_USER } from '../__fixtures__/users'
import { schema } from '../utils/schema'
import { setupEditor } from '../utils/setupEditor'
import nodeDiff from './node-diff.json'
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

  // test('should diff text starting from the start of the deleted range', async () => {
  //   const tester = setupEditor({
  //     doc: docs.paragraphsMarksOldDeleted[0],
  //     useDefaultPlugins: true,
  //     schema,
  //   }).paste(
  //     // Replace 'This is a partial' with 'This is a partial' -> ins ''
  //     new Slice(Fragment.from([schema.text('This is a partial')]), 0, 0),
  //     1,
  //     18
  //   );
  //   // The doc should stay the same as the text content being replace is equal

  //   expect(tester.toJSON()).toEqual(textDiff[0]);

  //   tester.paste(
  //     // Replace 'This is a ' with 'This is a partial' -> ins 'partial'
  //     new Slice(Fragment.from([schema.text('This is a partial')]), 0, 0),
  //     1,
  //     11
  //   );

  //   expect(tester.toJSON()).toEqual(textDiff[1]);

  //   // Replace 'partially' with 'partially' -> ins ''
  //   tester.cmd(undo).paste(
  //     new Slice(
  //       Fragment.from([
  //         schema.text('partial'),
  //         schema.text('ly', [
  //           schema.marks.tracked_delete.create({
  //             createdAt: 1661509955426,
  //             id: '0767eaed-b7bb-4f72-8842-9f707ef46473',
  //             status: 'rejected',
  //             statusUpdateAt: 0,
  //             userID: null,
  //           }),
  //         ]),
  //       ]),
  //       0,
  //       0
  //     ),
  //     11,
  //     20
  //   );
  //   expect(tester.toJSON()).toEqual(textDiff[0]);

  //   tester.cmd(undo).paste(
  //     // Replace 'ally' with 'partially'
  //     new Slice(
  //       Fragment.from([
  //         schema.text('partial'),
  //         schema.text('ly', [
  //           schema.marks.tracked_delete.create({
  //             createdAt: 1661509955426,
  //             id: '0767eaed-b7bb-4f72-8842-9f707ef46473',
  //             statusUpdateAt: 0,
  //             status: 'rejected',
  //             userID: null,
  //           }),
  //         ]),
  //       ]),
  //       0,
  //       0
  //     ),
  //     16,
  //     20
  //   );
  //   // await fs.writeFile('test.json', JSON.stringify(tester.toJSON()))

  //   expect(tester.toJSON()).toEqual(textDiff[2]);
  //   expect(uuidv4Mock.mock.calls.length).toBe(8);
  //   expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false);
  //   expect(log.warn).toHaveBeenCalledTimes(0);
  //   expect(log.error).toHaveBeenCalledTimes(0);
  // });

  test('should diff node delete + inserts as node updates and delete them if oldAttrs match newAttrs', async () => {
    const tester = setupEditor({
      doc: docs.equation,
      schema,
    })

    expect(tester.toJSON()).toEqual(nodeDiff[0])

    jest.useFakeTimers().setSystemTime(new Date('2020-05-05').getTime())

    tester.setNodeMarkup(14, { TeXRepresentation: '1+1=2' }).setChangeStatuses(CHANGE_STATUS.accepted)

    expect(tester.toJSON()).toEqual(nodeDiff[1])

    tester.setNodeMarkup(14, { TeXRepresentation: '' })

    expect(tester.toJSON()).toEqual(nodeDiff[3])

    jest.useFakeTimers().setSystemTime(new Date('2020-09-09').getTime())

    const x = tester
      .setNodeMarkup(14, { TeXRepresentation: '1+2=3' })
      .delete(13, 15)
      .setChangeStatuses(CHANGE_STATUS.rejected)

    x.moveCursor('start')

    // @TODO fix bug for this usecase (that's what this test does):
    /* 
      1. change attributes on a node with no changes,
      2. accept changes,
      3. change attributes again,
      4. delete node,
      5. reject all pending
      6. apply accepted
      Observe: applied attributes will be from the last rejected attributes change
      Note: This was only discovered in this commit but inotroduced sometime earlier
      This test should be uncommented and fixed after it's done --> expect(tester.toJSON()).toEqual(nodeDiff[0]);
    
    */
    expect(uuidv4Mock.mock.calls.length).toBe(6)
    expect(tester.trackState()?.changeSet.hasInconsistentData).toEqual(false)
    expect(log.warn).toHaveBeenCalledTimes(0)
    expect(log.error).toHaveBeenCalledTimes(0)
  })
})
