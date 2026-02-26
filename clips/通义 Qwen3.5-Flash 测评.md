---
title: "通义 Qwen3.5-Flash 测评 - 知乎"
source: "https://zhuanlan.zhihu.com/p/2010137454414434852"
author: ""
site: "知乎专栏"
published: ""
description: ""
clipped_at: "2026-02-26T09:11:09.242Z"
---
# 通义 Qwen3.5-Flash 测评 - 知乎

**短的结论：开源新锐的剑之所及**  
**基本情况：**  
春节前[通义](https://zhida.zhihu.com/search?content_id=270647443&content_type=Article&match_order=1&q=%E9%80%9A%E4%B9%89&zhida_source=entity)发了大杯的Plus作为新春贺礼，春节后则是发了剩余的中杯和小杯作为开工利是。百炼托管的[Qwen3.5-Flash](https://zhida.zhihu.com/search?content_id=270647443&content_type=Article&match_order=1&q=Qwen3.5-Flash&zhida_source=entity) 就是开源Qwen3.5-35B-A3B 增强版本，并且照例给了更低定价。  
官方宣称这一代Flash 拥有媲美前代235B 的实力，好消息是，推理模式下确实领先235B 一大截，但坏消息就很不乐观，新模式的稳定性还需打磨，中位来看仅仅打平。但这又何尝不是好消息，235B 体量可是大的多。通义仍然延续了新模跨级超过前代模型的战绩。  
  
  
**逻辑成绩：**

![](https://pic2.zhimg.com/v2-27efaf2ab47e471a68c6f21360610d53_1440w.jpg)

  
\*1 表格为了突出对比关系，仅展示部分**可对照模型**，不是完整排序。  
\*2 题目及测试方式，参见：[大语言模型-逻辑能力横评 26-01 月榜](https://zhuanlan.zhihu.com/p/2001065358270953002)。新增#56，#57，#58，#59题。  
\*3 完整榜单更新在 [https://llm2014.github.io/llm\_benchmark/](https://link.zhihu.com/?target=https%3A//llm2014.github.io/llm_benchmark/)  
\*4 红字模型代表工作在推理模式下(慢思考)，黑色模型则是对应的非推理模式(快思考)  
  
  
以下重点对比Qwen3.5-Flash（以下称Flash）与前代Qwen3-235B 7月版本（以下称235B）的差别。  
  
  
**改进：**

**目标推理**：在有唯一目标解的问题上，Flash 获得了来自更大模型蒸馏下来的能力，也可以做到推理聚焦，逐步推导和计算出目标，显著优于235B，部分问题甚至和更大的[Qwen3.5-Plus](https://zhida.zhihu.com/search?content_id=270647443&content_type=Article&match_order=1&q=Qwen3.5-Plus&zhida_source=entity)(397B) 不相上下。但不同于Plus 的稳定产出，Flash 通常也只有1 Pass 是显著提升，其余情况则各有错误。Qwen3.5 一代的蒸馏学习技术更加有效，但不够稳定。而一旦涉及开放问题，或目标不够明显，需要一定自主探索的问题，Flash 表现就不够亮眼，极限还能打平235B，而稳定性则大不如，多数时候毫无思路，用最原始穷举策略。**指令遵循**：Flash 的指令能力整体持平235B，但偶尔超预期表现，更接近大杯的Plus版本。而**非推理模式**则是天壤之别，不但做不到稳定遵循指令，反而会稳定的无视多指令中的某一部分。**多轮能力**：Flash 的多轮目标聚焦能力略强于235B，不过也较为受限。决策无法有效利用多轮的上下文，存在大量重复思考现象。这一点和大杯Plus 是相似的，不同在于，Plus 通常要到20 多轮，上下文累计到200K 之后才会出现问题，而Flash 则仅在不到15K 上下文就开始目标涣散。

  
  
**不足：**

**低效推理**：Flash 的**非推理模式**基本可以看到一个推理预算有限版的推理模型，输出内容与推理模型无异，平均Token 也创纪录的达到了8K，输出内容几乎是不可读的。受此连累，**推理模式**消耗量也居高不下。而且推理模式也把大量Token 浪费在最终输出上，有些问题的最终输出依然在推理，甚至反复确认答案。Flash 虽然与235B 在平均数上相差不大，但复杂推理，长链思维相关问题，Flash 消耗要远高于235B，但结果只轻微领先。**写作幻觉**：Flash 的上下文幻觉本身并没有比235B 差，基本持平。可一旦涉及到跟写作相关的内容，Flash 会显著的幻觉失控，大量输出与要求无关的文本。比如#30 题日记整理问题，在考察简单指令遵循外，也要求对原文进行改写，而Flash 毫无缘由的输出大量新年祝福内容。在另一Pass 中，又没有根据的称“日记主人”在应对通胀，十分离奇。这项问题也影响代码输出，Flash 会在输出大段代码注释后（这也可看做一种写作），更高概率的写错后续代码，导致一些低级语法错误。**脏输出**：Flash 无论推理和非推理模式，最终输出都有概率夹带英文，非推理的概率则更高。并且二者也都会频繁输出半个</think> 这种思维链蒸馏清洗不干净的遗物。这使得Flash 的输出可用性都较前代235B 更低，甚至也差于之前的验证模型Qwen3-Next。

  
  
**赛博史官曰：**  
Qwen 开源系列的小杯版本通常是很多个人和小团队本地部署的重点考量对象，而能力提升后的Qwen3.5-Flash 在纯复杂推理方面，已然看齐了去年初的平地一声雷[DeepSeek R1](https://zhida.zhihu.com/search?content_id=270647443&content_type=Article&match_order=1&q=DeepSeek+R1&zhida_source=entity) 初代。如果按相同运行内存消耗来看，Flash 综合能力甚至会好于R1 的极致量化版本。一年来的大模型进化速度可见一斑。  
但想必通义团队并不会止步于此，Flash 的不完善还需要时间打磨，迭代数月之后，是否应当刮目相看？  
  
  
目前所有评测文章在公众号：**[大模型观测员](https://zhida.zhihu.com/search?content_id=270647443&content_type=Article&match_order=1&q=%E5%A4%A7%E6%A8%A1%E5%9E%8B%E8%A7%82%E6%B5%8B%E5%91%98&zhida_source=entity)** 同步更新。  
月榜之后都改在月末发。
