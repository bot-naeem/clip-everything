---
title: "刚接触RLHF，请问RLHF就是一个multi-armed bandit吗？ - 知乎"
source: "https://www.zhihu.com/question/663685088/answer/2010288487912453827?share_code=ACh1UIIEWUaq&utm_psn=2010336889304007631"
author: ""
site: "知乎回答"
published: ""
description: ""
clipped_at: "2026-02-26T09:21:28.600Z"
---
# 刚接触RLHF，请问RLHF就是一个multi-armed bandit吗？ - 知乎

取决于你观察问题的颗粒度。在初学的时候，采用这个视角去理解，我感觉也没什么问题。我早前刚认识 [RLHF](https://zhida.zhihu.com/search?content_id=770766776&content_type=Answer&match_order=1&q=RLHF&zhida_source=entity) 时，也有类似的认识，参考这个回答：

但这个视角是有前提的。

## 一、[MDP](https://zhida.zhihu.com/search?content_id=770766776&content_type=Answer&match_order=1&q=MDP&zhida_source=entity) vs [Bandit](https://zhida.zhihu.com/search?content_id=770766776&content_type=Answer&match_order=1&q=Bandit&zhida_source=entity) 的数学建模

这个前提是什么先按下不表，我们先给出 MDP 和 Bandit 的数学建模，方面后面对照讨论。

标准 MDP 建模是这样一个四元组：

(s\_t, a\_t, r\_t, s\_{t+1}) \\\\

直观含义是：在当前状态 s\_{t} 下采取动作 a\_{t}，通过奖励函数获得即时奖励 r\_{t}，并通过状态转移函数到达下一时刻的状态 s\_{t+1}。

MDP 的优化目标是：

\\max\_\\pi \\mathbb{E}\\left\[\\sum\_t \\gamma^t r\_t\\right\] \\\\

注意，这里核心的要点（呆会跟 Bandit 区分）：

行动影响未来状态分布奖励可能在中间产生

再来看 Bandit 的建模，这里我们特指 **上下文老虎机（[Contextual Bandit](https://zhida.zhihu.com/search?content_id=770766776&content_type=Answer&match_order=1&q=Contextual+Bandit&zhida_source=entity)）**，因为 RLHF 中的 Prompt 充当了上下文（Context）的角色。

它没有「时间」和「状态迁移」的概念，只有「上下文」x，在这个上下文中选择动作 a，得到奖励 r(x,a)，不会对后续动作造成影响。就像它的名字「老虎机」一样，这一把的输赢不影响下一把。

Bandit 的优化目标是：

\\max\_\\pi \\mathbb{E}\_{x \\sim D, a \\sim \\pi(\\cdot|x)}\[r(x,a)\] \\\\

![](https://picx.zhimg.com/50/v2-f06d4b321030ccee753b9478aed2a9df_720w.jpg?source=2c26e567)

## 二、RLHF 的建模

我们拿最原始的 RLHF 流程举例：

给定 Prompt x采样若干回答序列 y\_1,\\dots,y\_n（注意每一个 y 都是一个完整回答，包含若干 token）人类排序训练奖励模型 R\_\\phi(x,y)用 [PPO](https://zhida.zhihu.com/search?content_id=770766776&content_type=Answer&match_order=1&q=PPO&zhida_source=entity) 优化语言模型：

\\max\_\\pi \\mathbb{E}\_{y\\sim\\pi(\\cdot|x)} \\left\[ R\_\\phi(x,y) - \\beta KL(\\pi || \\pi\_{SFT}) \\right\] \\\\

注意 reward 只在完整序列 y 上定义，中间 token 没有单独奖励，没有显式状态奖励。

![](https://picx.zhimg.com/50/v2-1b508ae9fb4a9c2b91c1dd93f87d3bbe_720w.jpg?source=2c26e567)

如果你把每个 token 当成一个时间步，相当于：

r\_t = 0 \\quad (t < T), \\quad r\_T = R(x,y) \\\\

你可以把它看作一个「只在最终步获得奖励」的 MDP，也可以用 Bandit 的视角去看待它。后者前提是：我们把整条输出 y 看作一个「动作」（而不是每个 token 是一个动作）。

在这个前提下，Prompt 就可以看作上下文，奖励函数就可以看作一个「即时奖励」了（而不是只在最后一步获得的稀疏奖励）。

在这个层面上，它确实可以看作某种 Contextual Bandit。

## 三、生成过程用 MDP 描述更自然

但是，当你去看 LLM 生成过程时，单纯使用 Bandit 这个视角就又有些局限了。因为我们看待 LLM 的生成时，不可避免地要把它看成「逐 token 生成」的过程，需要一个「时间轴」。这个时候，采用 MDP 视角会更自然：

状态：s\_t = (x, y\_{\\lt t})，其中 x 表示 Prompt 上下文，y 是 token 级别的输出，y\_{\\lt t} 表示截止当前状态已经生成了的 token 序列动作：a\_t = y\_t，就是当前状态下生成的 token状态转移：s\_{t+1} = (x, y\_{\\le t})，相当于把生成的 y\_{t} 拼接到了当前状态后面奖励：r\_T = R(x,y)，只有在最后一步 `EOS` 有奖励。
![](https://pic1.zhimg.com/50/v2-9709a9e4ebbe3dc4665ecf2f23760b92_720w.jpg?source=2c26e567)

> PS：这个 MDP 的环境转移基本是确定性的拼接，随机性主要来自策略采样，而不是环境动力学。因此 LLM 里的 RL 更像在做序列决策的策略优化，不是传统控制问题。

采用这个「token 级动作」的视角，我们也才容易去分析 RLHF 采用的 PPO 算法的运作原理。

## 四、[DPO](https://zhida.zhihu.com/search?content_id=770766776&content_type=Answer&match_order=1&q=DPO&zhida_source=entity) 是更适合 Bandit 的视角

后来的 DPO（Direct Preference Optimization）用了一个巧妙的数学变换，证明 PPO 优化可以转换成一个闭式的 log-ratio 优化。

DPO 做的核心假设就是 reward 是单步的，只取决于完整输出 R(x,y)，没有未来状态。

这种情况下 PPO-style RLHF 的最优解具有指数加权形式：

\\pi^\*(y|x) \\propto \\pi\_0(y|x)\\exp(\\frac{1}{\\beta} R(x,y)) \\\\

通过这一关系，我们可以消去显式的奖励函数，通过偏好数据得到：

\\max \\log \\sigma\\big(\\beta(\\log \\pi(y^+) - \\log \\pi(y^-))\\big) \\\\

也就是说，DPO 的视角更接近 Bandit 假设。

关于 RLHF、SFT、DPO 之间的联系和区别，不久之前我刚写过一篇回答，可以作为补充资料参考：

## 五、One More Thing

事实上后来的广义 RLHF 花样层出不穷，已经不完全适用于 Bandit 假设了，比如：

多轮对话：上轮回复会改变下轮 Prompt（状态转移真实存在）工具使用 / Agent：动作会影响环境返回（检索结果、工具输出）过程奖励：中间 token/步骤有奖励信号

---

> 如果你觉得以上内容对你有所帮助，请不要吝惜你的点赞、分享与关注。任何互动都非常欢迎，也鼓励「批判性」转发～
