# Supported training log formats

Enter the actual metric name in normal mode. No surrounding quotes or trailing colon is needed. This applies to any numeric metric, including reward, entropy, KL, loss and gradient norm. Multiple fields use a JSON list, e.g. `["reward","entropy"]`.

## Compatibility matrix

The examples below are representative fixtures based on upstream documentation/logging code, checked on 2026-11-07. Regression coverage checks parsing, not a live training run of every framework/version.

| Framework / output | Supported format | Example field to enter | Upstream reference |
| --- | --- | --- | --- |
| Transformers / TRL (including applications using Trainer) | Python dict console output; numeric or quoted numeric values | `loss`, `reward`, `objective/rlhf_reward` | [PrinterCallback](https://github.com/huggingface/transformers/blob/main/src/transformers/trainer_callback.py), [TRL metrics](https://huggingface.co/docs/trl/main/en/logging) |
| Transformers trainer state | JSON `log_history` records | `loss`, `grad_norm` | [TrainerState](https://github.com/huggingface/transformers/blob/main/src/transformers/trainer_callback.py) |
| Megatron-LM | Pipe-separated metrics and scientific notation | `lm loss`, `grad norm` | [training logger](https://github.com/NVIDIA/Megatron-LM/blob/main/megatron/training/training.py) |
| verl (GPU / Ascend text logs) | `step:10 - critic/rewards/mean:0.8 - actor/pg_loss:-0.2` | `critic/rewards/mean`, `actor/pg_loss` | [console logger](https://github.com/verl-project/verl/blob/main/verl/utils/logger/aggregate_logger.py), [Ascend metrics](https://github.com/verl-project/verl/blob/main/docs/ascend_tutorial/en/dev_guide/model_dev/parameter_and_metrics.md) |
| MindSpore / MindFormers | Colon-separated console metrics, singleton arrays such as `global_norm: [45.7]` | `loss`, `grad_norm`, `global_norm` | [dynamic graph logs](https://www.mindspore.cn/mindformers/docs/en/r2.0.0/feature/logging.html), [static graph example](https://www.mindspore.cn/mindformers/docs/zh-CN/master/static_graph/feature/high_availability.html) |
| DeepSpeed / custom PyTorch loops | Text scalar fields separated by colon, equals or whitespace; scalar `tensor(...)` | Actual printed field name | [DeepSpeed pipeline engine](https://github.com/deepspeedai/DeepSpeed/blob/master/deepspeed/runtime/pipe/engine.py) |
| Stable-Baselines3 | Grouped console tables; CSV / JSON output | `rollout/ep_rew_mean`, `train/loss`, `eval/mean_reward` | [logger formats and table](https://stable-baselines3.readthedocs.io/en/master/common/logger.html) |
| Ray RLlib / Tune | Nested JSON / JSONL, including `result.json` | `env_runners/episode_return_mean` | [RLlib metrics](https://docs.ray.io/en/latest/rllib/getting-started.html), [JSON logger](https://github.com/ray-project/ray/blob/master/python/ray/tune/logger/json.py) |
| PyTorch Lightning CSVLogger / other CSV exporters | CSV / TSV with a header row, quoted cells and missing values | Column name, e.g. `train_loss` | [CSVLogger](https://lightning.ai/docs/pytorch/stable/reference/generated/lightning.pytorch.loggers.CSVLogger) |

## Matching rules and limits

- Case is ignored. Spaces, underscores and hyphens between words are interchangeable. Full paths are retained: `reward` does not alias `critic/rewards/mean`.
- Nested JSON paths use `/`. SB3 table section headings are preserved in the same way: use `train/loss` for the loss row under `train/`.
- Numeric strings, singleton numeric arrays, scalar PyTorch tensors and NumPy float wrappers are accepted. Vectors, null, NaN and infinity are skipped. No averaging of arrays is inferred.
- Console colors are stripped in normal mode. CR, LF and CRLF lines are supported.
- Known adjacent units (`ms`, `us`, `s`, `T`, `%`, `tokens/s`) are accepted without conversion. Match units between runs before comparing.
- Each text line / JSON record contributes at most one value per configured field. Missing values are skipped. Existing charts compare sample order, not recorded step IDs: use equivalent logging schedules for comparisons.
- CSV/TSV requires a header and at least one numeric cell in the first data row. Multiline CSV cells, arbitrary pretty-printed Python nested objects, vector values, binary TensorBoard events and remote tracking-service APIs are outside this parser's coverage. Export scalar data as CSV or JSON/JSONL for those cases.
- Regex mode uses original lines, without structural normalization.

Run regression checks: `node --test tests/parser-data.test.cjs`.
