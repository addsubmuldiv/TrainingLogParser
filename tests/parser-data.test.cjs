const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KeyData, FileData } = runInNewContext(
    readFileSync(require('node:path').join(__dirname, '../js/log-parser/parser-data.js'), 'utf8') +
    '\n;({ KeyData, FileData });'
);

function parse(key, text, regex = false) {
    const data = new KeyData(key, regex);
    data.parseText(text.split('\n'));
    return Array.from(data.parsedData);
}

test('bare field handles common training log formats and numeric notation', () => {
    for (const line of ['loss: 0.5', "{'loss': 0.5}", '{"loss":0.5}',
        'loss = 0.5', 'loss 0.5', 'LOSS：0.5', 'loss:\t0.5']) {
        assert.deepEqual(parse('loss', line), [0.5], line);
    }
    assert.deepEqual(parse('loss', 'loss: -.5e-2\nloss: +2E+3\nloss: 0\nloss: 1.'), [-0.005, 2000, 0, 1]);
});

test('saved punctuation and field separator variants work', () => {
    for (const key of ['loss:', "'loss':", '"loss":', ' loss = ']) {
        assert.deepEqual(parse(key, '{"loss": 2}'), [2]);
    }
    assert.deepEqual(parse('grad norm', 'grad_norm: 1\ngrad-norm = 2\ngrad norm: 3'), [1, 2, 3]);
    assert.deepEqual(parse('actor/grad_norm', 'actor/grad_norm: 4'), [4]);
    assert.deepEqual(parse('(ms):', '(ms): 5'), [5]);
});

test('does not confuse neighboring fields or consume unrelated numbers', () => {
    for (const line of ['eval_loss: 1', 'total-loss: 2', 'actor/loss: 3', 'loss_scale: 4',
        'loss: unavailable step: 12', 'loss: nan step: 12', 'loss: 1e- step: 12',
        'loss: 2abc', 'loss: "step 12"']) {
        assert.deepEqual(parse('loss', line), [], line);
    }
    assert.deepEqual(parse('loss', 'eval_loss: 9, loss: 2, step: 10'), [2]);
    assert.deepEqual(parse('', 'step: 12'), []);
});

test('multi-field GPU/NPU logs use the same configuration', () => {
    const gpu = new FileData('gpu', "{'loss': 0.5, 'grad_norm': 1.2}");
    const npu = new FileData('npu', 'loss: 0.6 | grad norm: 1.3');
    for (const file of [gpu, npu]) file.updateKeys('["loss","grad norm"]', false);
    assert.deepEqual(Array.from(gpu.keyDatas.loss.parsedData), [0.5]);
    assert.deepEqual(Array.from(npu.keyDatas.loss.parsedData), [0.6]);
    assert.deepEqual(Array.from(gpu.keyDatas['grad norm'].parsedData), [1.2]);
    assert.deepEqual(Array.from(npu.keyDatas['grad norm'].parsedData), [1.3]);
});

test('explicit regular expressions retain their behavior', () => {
    assert.deepEqual(parse('(?<=loss: )\\d+\\.\\d+', 'loss: 0.5', true), [0.5]);
});

test('Transformers/TRL formatted numeric strings and RL metric names', () => {
    assert.deepEqual(parse('reward', "{'loss': '0.12', 'reward': '2.5', 'entropy': '0.03'}"), [2.5]);
    assert.deepEqual(parse('objective/rlhf_reward', '{"objective/rlhf_reward": -1.25}'), [-1.25]);
});

test('Megatron scientific values, verl console and MindFormers scalar wrappers', () => {
    assert.deepEqual(parse('lm loss', 'iteration 10 | lm loss: 2.345E+00 | grad norm: 1.5 |'), [2.345]);
    assert.deepEqual(parse('critic/rewards/mean', 'step:10 - critic/rewards/mean:0.8 - actor/pg_loss:-0.2'), [0.8]);
    const line = '[INFO] step:[ 100/1000], loss: 2.345, global_norm: [45.7], per_step_time: 850ms';
    assert.deepEqual(parse('global norm', line), [45.7]);
    assert.deepEqual(parse('per_step_time', line), [850]);
    assert.deepEqual(parse('loss', "loss=tensor(0.25, device='npu:0', grad_fn=<MeanBackward0>)"), [0.25]);
    assert.deepEqual(parse('reward', 'reward: np.float64(1.5)'), [1.5]);
});

test('RLlib nested JSONL retains metric namespaces', () => {
    const lines = '{"env_runners":{"episode_return_mean":12},"evaluation":{"env_runners":{"episode_return_mean":8}}}\n' +
        '{"env_runners":{"episode_return_mean":14}}';
    assert.deepEqual(parse('env_runners/episode_return_mean', lines), [12, 14]);
    assert.deepEqual(parse('evaluation/env_runners/episode_return_mean', lines), [8]);
    assert.deepEqual(parse('episode_return_mean', lines), []);
});

test('JSON arrays and Transformers trainer_state log_history', () => {
    const records = [{ loss: 0.5, step: 1 }, { loss: 0.4, step: 2 }];
    assert.deepEqual(parse('loss', JSON.stringify(records, null, 2)), [0.5, 0.4]);
    assert.deepEqual(parse('loss', JSON.stringify({ best_metric: 9, log_history: records }, null, 2)), [0.5, 0.4]);
});

test('SB3 console tables retain rollout/train/eval groups', () => {
    const table = '--------------------\n| rollout/ | |\n| ep_rew_mean | 12 |\n| train/ | |\n| loss | 0.5 |\n' +
        '| eval/ | |\n| loss | 9 |\n--------------------\n| rollout/ | |\n| ep_rew_mean | 14 |';
    assert.deepEqual(parse('rollout/ep_rew_mean', table), [12, 14]);
    assert.deepEqual(parse('train/loss', table), [0.5]);
    assert.deepEqual(parse('eval/loss', table), [9]);
});

test('CSV/TSV metric files, quoted headers, blank cells and comments', () => {
    assert.deepEqual(parse('train/loss', '# metadata\n"step","train/loss","reward"\n1,0.5,12\n2,,14\n3,0.3,15'), [0.5, 0.3]);
    assert.deepEqual(parse('reward', 'step\treward\n1\t12\n2\t14'), [12, 14]);
});

test('ANSI colors and carriage-return progress output', () => {
    const file = new FileData('console', '\x1b[32mloss:\x1b[0m 0.5\rloss: 0.4');
    file.updateKeys('loss', false);
    assert.deepEqual(Array.from(file.keyDatas.loss.parsedData), [0.5, 0.4]);
});

test('vectors, nonfinite values and malformed scalar strings are not data points', () => {
    for (const text of ['loss: [1, 2]', 'loss: tensor([1, 2])', 'loss: "1e-"',
        'loss: 1e999', 'loss: inf', 'loss: None', 'loss: 2abc', 'loss: "3abc"']) {
        assert.deepEqual(parse('loss', text), [], text);
    }
});

test('file regex mode still sees original JSON and ANSI text', () => {
    const file = new FileData('json', '{"nested":{"loss":0.5}}');
    file.updateKeys('(?<="loss":)0\\.5', true);
    assert.deepEqual(Array.from(file.keyDatas['(?<="loss":)0\\.5'].parsedData), [0.5]);
});

test('DeepSpeed scalar console and Lightning sparse CSV metrics', () => {
    assert.deepEqual(parse('loss', '[INFO] step=10, loss = 2.345, iter time (s) = 0.8'), [2.345]);
    assert.deepEqual(parse('train_loss', 'epoch,step,train_loss,val_loss\n0,1,0.5,\n0,1,,0.6\n0,2,0.4,'), [0.5, 0.4]);
});

test('fixture files compare reward and gradient norm across GPU/NPU representations', () => {
    const path = require('node:path');
    const gpu = new FileData('gpu', readFileSync(path.join(__dirname, 'fixtures/rl-gpu.jsonl'), 'utf8'));
    const npu = new FileData('npu', readFileSync(path.join(__dirname, 'fixtures/rl-npu.log'), 'utf8'));
    for (const file of [gpu, npu]) file.updateKeys('["reward","grad norm"]', false);
    for (const key of ['reward', 'grad norm']) {
        const a = gpu.keyDatas[key].parsedData;
        const b = npu.keyDatas[key].parsedData;
        assert.equal(a.length, 3);
        assert.equal(b.length, 3);
        for (let i = 0; i < a.length; i++) assert.ok(Math.abs(b[i] - a[i] - 0.01) < 1e-12);
    }
});
