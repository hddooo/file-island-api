import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sequenceNumbersMatch} from '../../src/textbook/sequence-grading';
import {multipleAnswerDetails} from '../../src/textbook/multiple-answer-grading';

test('numbered sequence preserves multi-digit order and rejects malformed tokens',()=>{
 const expected=['10','2','20'];
 for(const value of ['10 2 20','⑩→②→⑳','10->2->20','10，2，20'])assert.equal(sequenceNumbersMatch(value,expected),true,value);
 for(const value of ['10220','010 2 20','10 20 2','10,2,20,','10/2/20','10 2 20 20'])assert.equal(sequenceNumbersMatch(value,expected),false,value);
 assert.equal(sequenceNumbersMatch('21',['21']),false);
 assert.equal(sequenceNumbersMatch('',[]),false);
});

test('multiple answers retain exact punctuation, duplicates and whitespace ambiguity',()=>{
 const expected=['가 나','다'];
 assert.equal(multipleAnswerDetails('다，가 나',expected).correct,true);
 assert.equal(multipleAnswerDetails('가 나 다',expected).correct,true);
 for(const value of ['가나,다,다','가나/다','가나,다,라'])assert.equal(multipleAnswerDetails(value,expected).correct,false,value);
 assert.equal(multipleAnswerDetails('가 나 다',['가','나다','가나','다']).correct,false);
 assert.equal(multipleAnswerDetails('가-나,다',expected).correct,false);
 assert.deepEqual(multipleAnswerDetails('다',expected),{correct:false,matched:1,total:2,missing:['가 나'],partial:true});
});
