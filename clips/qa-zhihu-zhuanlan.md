---
title: "万字详解Search Agent 数据合成方案（DeepDive、WebSailor-V2、REDSearcher） - 知乎"
source: "https://zhuanlan.zhihu.com/p/2007944059558323475?share_code=wpShSwJIjJWb&utm_psn=2010112084201980758"
author: ""
site: "知乎专栏"
published: ""
description: ""
clipped_at: "2026-02-26T09:25:10.189Z"
---
# 万字详解Search Agent 数据合成方案（DeepDive、WebSailor-V2、REDSearcher） - 知乎

## 总表

| Method | 数量 | BrowseComp | 发布机构 | 发布时间 |
| --- | --- | --- | --- | --- |
| DeepDive | SFT：1016   RL：2234   总：3250 | 15.3 | 清华&智谱 | 2025.9.12 |
| [WebSailor-V2](https://zhida.zhihu.com/search?content_id=270459348&content_type=Article&match_order=1&q=WebSailor-V2&zhida_source=entity) | 30000+ | 35.3 | 阿里通义 | 2025.9.16 |
| [REDSearcher](https://zhida.zhihu.com/search?content_id=270459348&content_type=Article&match_order=1&q=REDSearcher&zhida_source=entity) | SFT：10000   RL：1000   总：30000 | 42.1   57.4(with context management) | 小红书 | 2026.2.17 |

目前Search Agent的数据合成方案基本都遵循了三步流程：

- 构建[知识图谱](https://zhida.zhihu.com/search?content_id=270459348&content_type=Article&match_order=1&q=%E7%9F%A5%E8%AF%86%E5%9B%BE%E8%B0%B1&zhida_source=entity)
- 选定一个初始节点，[随机游走](https://zhida.zhihu.com/search?content_id=270459348&content_type=Article&match_order=1&q=%E9%9A%8F%E6%9C%BA%E6%B8%B8%E8%B5%B0&zhida_source=entity)生成子图
- 根据子图生成QA对

不同的方法之间的区别主要是针对这三步流程的每一步会各有一些特定的优化。

## DeepDive

[https://openreview.net/pdf?id=gSI7K0JbpS](https://link.zhihu.com/?target=https%3A//openreview.net/pdf%3Fid%3DgSI7K0JbpS)

[https://github.com/THUDM/DeepDive/tree/main/qa\_synthetic](https://link.zhihu.com/?target=https%3A//github.com/THUDM/DeepDive/tree/main/qa_synthetic)

本文先介绍DeepDive，因为其有完整的开源实现代码，整体方案也比较简单易懂。

![](https://pic3.zhimg.com/v2-79393efc319b66e3760d24a5bc2232fa_r.jpg)

如上图所示，整体数据合成的过程为：

- 在知识图谱里选择一个初始节点A，然后开始进行随机游走，获得**富属性路径**A(1)->B(2, 3)->C(4)-D(5)，特别的，游走过程中施加两项约束，来提升路径复杂度和逻辑合理性；
- **节点出度过滤：**设定合理的出度范围\[dmin, dmax\]筛选候选节点。若节点出度过高，其相关性过泛，会让模型轻易预测出答案；若出度过低，则会阻碍路径的有效扩展；
	- **[LLM](https://zhida.zhihu.com/search?content_id=270459348&content_type=Article&match_order=1&q=LLM&zhida_source=entity)辅助节点选择：**为保证路径的逻辑一致性，利用LLM选择与当前路径最相关的下一节点。
- 将这个**富属性路径**交由LLM来生成QA对，从路径的终端节点中选择一个属性作为标准答案，再利用LLM将路径中部分实体的一些属性进行**模糊化处理**，来提升生成问题的复杂度和模糊性，例如将具体日期泛化为时间范围，如节点A的属性1，节点B的属性3。
- 为进一步提升问题的难度，利用具备基础检索能力的前沿模型（如 GPT-4o）搭建自动化过滤机制：对每个生成的问题进行四次测试，若模型在任意一次测试中解答成功，则舍弃该问题；仅保留模型四次均解答失败的问题。

接下来，我们再看一下具体实现代码，了解一下其中的细节：

### **随机游走代码：**

[DeepDive/qa\_synthetic/random\_walk\_kilt.py at main · THUDM/DeepDive · GitHub](https://link.zhihu.com/?target=https%3A//github.com/THUDM/DeepDive/blob/main/qa_synthetic/random_walk_kilt.py)

**核心目标：**

从指定起始节点出发，在 KILT 知识图谱中进行**可控随机游走**，生成满足以下条件的多跳路径：

- 路径长度≥5（保证推理复杂度）；
- 节点间逻辑关联（通过 LLM 选择下一跳，避免无意义跳转）；
- 过滤歧义词条、无效节点，保证路径有效性。

**步骤1:初始化准备**

**1、环境加载**：通过load\_dotenv()加载OpenAI/OpenRouter API密钥（用于LLM选下一跳）

**2、客户端初始化：**

- KiltClient：连接本地MongoDB（已导入KILT维基数据），用于查询节点信息
- RandomWalk实例：传入KiltClient、LLM客户端（如OpenAI）、LLM模型（如GPT-4o）

**步骤2:初始节点查询**

以游走起点为"Artificial Intelligence"为例，执行以下操作

```
text = self.kilt_client.query_text("Artificial Intelligence")  # 查询AI的维基文本
anchors = self.kilt_client.query_relations("Artificial Intelligence")  # 查询AI页面的锚点（关联节点）
search_result = self.kilt_client.kilt_search("Artificial Intelligence")  # 验证节点有效性
if not (search_result and search_result.get("hits", {}).get("hits")):
    raise ValueError(f"Invalid search result for node: {current_node}")
# 获取标准化标题："Artificial intelligence"
title = search_result["hits"]["hits"][0]["_source"].get("wikipedia_title", current_node) or current_node
# 1. 截断text中"See also/参考资料"等无效段落(作为删除文本)
# 2. 只保留「字典类型 + 标题非空 + 标题不在被删除文本中」的锚点
text, anchors = cut_see_also_and_filter_anchors(text, anchors)
```

- 结果示例
- text：保留AI维基页面的核心介绍（如“AI is the simulation of human intelligence processes by machines…”）
	- anchors：有效锚点列表，包含：{"href": "Machine learning", "text": "machine learning"}, {"href": "Neural network", "text": "neural network"} 等

**步骤3：筛选下一跳候选节点（find\_next\_candidate）**

**1、候选过滤**

- 随机打乱锚点列表，过滤掉已访问的节点（visited初始集合为空）
- 对每个锚点，查询其对应的维基百科页面：验证是否有≥3个锚点（保证后续可继续游走）、不是歧义词条（如"disambiguation"不在标题中出现）、与当前节点不同
- 筛选出候选列表（最多5个），如：\["Machine learning", "Neural network", "Natural language processing", "Computer vision", "Reinforcement learning"\]

**2、LLM选择最相关节点**

构造prompt给LLM（要求仅返回数字）

```
Current topic: Artificial intelligence
Current context: AI is the simulation of human intelligence processes by machines...

Please select the most logically connected next topic from the following candidates.
Respond with ONLY a number from 1 to 5.

1. machine learning: Machine learning is a subset of AI that enables systems to learn from data...
2. neural network: A neural network is a computational model inspired by the human brain...
3. natural language processing: NLP is a branch of AI that focuses on interactions between computers and human language...
4. computer vision: Computer vision is a field of AI that enables machines to interpret and understand the visual world...
5. reinforcement learning: Reinforcement learning is a type of machine learning where an agent learns to make decisions...
```

LLM返回1，选择"Machine Learning"作为下一跳。

**步骤4:路径迭代与失败处理**

**1、路径构建：**将 {"step": 0, "title": "Artificial intelligence", "text": "...", "anchors": \[...\]} 加入路径，visited 集合添加该标题（小写）；

**2、下一跳节点处理：**以"Machine Learning"为新的当前节点，重复步骤2-3；

- 查询"Machine Learning"的维基文本、锚点；
- 筛选候选节点（如 "Supervised learning", "Unsupervised learning", "Deep learning"）；
- LLM选择"Deep learning"作为第2跳；

**3、失败回退逻辑：**

- 若某节点查询失败（如"Deep learning"无有效锚点）：清空当前子路径，从历史节点（history\_nodes：{“Artificial intelligence”, “Machine learning”}）中随机选一个（如 “Machine learning”）重新开始；
- 若历史节点无有效候选，终止该分支游走。

**步骤5：路径保存**

当子路径长度达到save\_every\_k=5（默认5步），保存路径：

```
{
  "relations": ["Artificial intelligence", "Machine learning", "Deep learning", "Neural network", "Transformer (machine learning)"],
  "nodes": {
    "Artificial intelligence": "AI is the simulation of human intelligence...",
    "Machine learning": "Machine learning is a subset of AI...",
    "Deep learning": "Deep learning is a subset of machine learning...",
    "Neural network": "Neural networks are inspired by the human brain...",
    "Transformer (machine learning)": "Transformers are a type of neural network..."
  },
  "id": "walk-1-thread-0-step-5"
}
```

**步骤6：循环直至完成**

在完成一段save\_every\_k步的子路径后，若仍未达到总步数（num\_steps=100）和最大访问节点数（max\_visited=100），则通过「多步随机跳转」切换到新的未访问节点（作为下一个初始节点），既保证游走的随机性，又避免重复访问，同时确保新节点有足够的锚点（关系）支撑后续游走。

接着，重复步骤2-5，直到生成游走步数达到num\_steps=100，或visited节点数达到max\_visited=100（避免无限游走）时停止

### **生成QA代码：**

[https://github.com/THUDM/DeepDive/blob/main/qa\_synthetic/generate\_qa.py](https://link.zhihu.com/?target=https%3A//github.com/THUDM/DeepDive/blob/main/qa_synthetic/generate_qa.py)

**核心目标：**

基于 random\_walk\_kilt.py 生成的知识图谱多跳路径（如 \[AI→机器学习→深度学习→神经网络→Transformer\]），让 LLM 生成满足以下条件的 QA 对：

- 问题必须**沿路径多步推理**才能回答（不能直接关键词匹配）；
- 实体/属性需**模糊化**（如不说“Transformer”，而说“该深度学习分支中基于自注意力机制的神经网络模型”）；
- 答案必须是路径最后一个节点的唯一属性（如 Transformer 的核心机制、发明年份等）；
- 过滤含歧义词条的路径，保证 QA 有效性。

**步骤1：路径校验与过滤**

- 检查路径中无歧义词条
- 提取relations（路径节点列表）和nodes（节点描述字典）

**步骤2：组装Prompt**

将路径和节点信息填充到prompt.py的GENERATE\_QUESTION\_KILT模版中，生成完整Prompt：

```
You are given:

A path, which is an ordered sequence of entities (nodes) from a random walk on Wikipedia, each linked by specific relationships.
For each node, a description (node introduction) is provided, detailing key attributes such as names, places, events, or times.
Your task:

Identify one attribute from the last node in the path (this could be a name, place, event, or time), and construct a question whose answer is exactly the value of that attribute.
Your question must require the solver to follow the path step by step, using each node and relationship in order to arrive at the solution; the clues should be layered so that each step depends on the previous one.
Do not directly mention the actual names, places, dates, or events in the path or node introductions. Instead, paraphrase or generalize all clues and relationships, so the answer cannot be obtained by simple keyword matching. 

The question should include up to 15 unique clues, each clue building upon information from the previous node or relationship, reflecting the path's structure.
The question should be concise, logically connected, and solvable strictly using the information from the path and node descriptions. 
The relationship between the next node and the previous node is buried in the text of the previous node, and the connection between them must be mentioned and!
Every node's information should be mentioned in the question. 
The answer must be unique and must exactly match the value of the selected attribute from the last node. 
Try to keep the question length (number of characters) less than 800.
All time/name/event/place information in the puzzle needs to be obscured!

Input:
Paths: ['Artificial intelligence', 'Machine learning', 'Deep learning', 'Neural network', 'Transformer (machine learning)'] 
Node Introductions: {'Artificial intelligence': 'Artificial intelligence (AI) is the intelligence of machines or software...', 'Machine learning': 'Machine learning (ML) is a subset of AI that enables systems to learn from data...', 'Deep learning': 'Deep learning is a subset of ML using multi-layer neural networks...', 'Neural network': 'A neural network is a computational model inspired by the human brain...', 'Transformer (machine learning)': 'The Transformer is a deep learning model proposed in 2017, based on self-attention mechanism, used in NLP and CV...'}

Please strictly follow the output format below:

<question>: (A multi-step, path-ordered question in English)
<answer>: (The unique answer)
```

**步骤3：调用LLM**

LLM返回结果示例

```
<question>: In the field of machine-enabled intelligent systems, its subset that focuses on data-driven learning has a branch using multi-layer brain-inspired computational models, and this model category includes a 2017-proposed architecture for NLP/CV based on a specific attention mechanism. What is the core mechanism of this architecture?
<answer>: self-attention mechanism
```

**步骤4：解析QA**

通过正则匹配提取 <question> 和 <answer>：

```
{"question": "...", "answer": "self-attention mechanism"}
```

**步骤5：返回结果**

将解析后的 QA 与原路径的 id 合并，返回最终结果：

```
{
  "question": "In the field of machine-enabled intelligent systems, its subset that focuses on data-driven learning has a branch using multi-layer brain-inspired computational models, and this model category includes a 2017-proposed architecture for NLP/CV based on a specific attention mechanism. What is the core mechanism of this architecture?",
  "answer": "self-attention mechanism",
  "id": "walk-0-thread-0-step-5"
}
```

### 实验结果

![](https://picx.zhimg.com/v2-7ead9228b8b1aafc03f4e5072187d741_r.jpg)

方法看起来不错，但是BrowseComp也只有15.3分，可能问题的难度和多样性还是不够。另外，数据集只有3000条，数量上也略显不足。

## WebSailor-V2

[https://openreview.net/pdf?id=HuP16O5SJf](https://link.zhihu.com/?target=https%3A//openreview.net/pdf%3Fid%3DHuP16O5SJf)

主要贡献了SailorFog-QA-V2数据集，但是没开源。主要的优化点在于：

**1、图谱构建：**

以一个种子实体为起点，使用了Web工具扩展关联实体，而不是直接使用现成的wikipedia图谱。

**2、子图提取：**

除了使用随机游走策略来采样子图外，还通过[Weisfeiler-Leman算法](https://zhida.zhihu.com/search?content_id=270459348&content_type=Article&match_order=1&q=Weisfeiler-Leman%E7%AE%97%E6%B3%95&zhida_source=entity)验证子图”非同构性“，确保提取的子图涵盖从简单链到复杂循环、含割点/桥等多种拓扑结构，全面覆盖各种复杂的推理场景。

**3、QA生成：**

通过**三种混淆方式**来增加问题难度：

**1\. 通过语境歧义进行语义混淆：** 故意设计一些问题，其中**关键信息要么没有明确说明，要么仅以间接方式描述**——例如，用“首次发表这项工作的两场重要会议中较早的一场”来指代，而不是直接说出会议地点；或者使用角色描述（例如，“后来推广了这一结果的数学家”），而不是直接使用实体名称。这些情况要求智能体 (i) 从歧义的语境中推理并重建缺失的实体，以及 (ii) 在回答之前验证是否已正确消除歧义。这超越了简单的混淆，因为它使得从描述到实体本身的映射变得复杂。

**2\. 噪声信息包含错误信息：** 除了简单地掩盖或改写关键实体（标准混淆）之外，有时还会向子图或检索到的证据中**插入一些事实上不正确的干扰项**。例如，当正确答案涉及某篇论文的发表年份时，可能会插入一个与同一作者的另一篇相关论文的发表年份；或者，当任务涉及某位科学家的所属机构时，会加入一个在该图的同一邻域中频繁出现的密切相关的机构。这迫使智能体不仅要“找到看起来正确的信息”，还要交叉核对多个来源，并主动排除不一致的证据，从而进行矛盾检测和纠错，而不是仅仅依赖于浅层的模式匹配。

**3\. 非同构子图结构的结构分析：** 系统地研究了非同构子图结构如何影响问答难度和推理模式，这是主要贡献。采用基于随机游走的方法，并结合 Weisfeiler-Leman 验证，提取出多种子图并分析其结构复杂性。通过策略性地从采样子图中**移除关键节点/边**（例如，被切割的顶点/桥）来引入可控的不确定性。这要求智能体通过替代路径或知识图谱冗余来重构多跳关系，从而鼓励全局性的、拓扑感知的推理，而非局部邻接依赖。这些不确定性类型分布在轨道节点（不同的结构角色）上，以确保推理覆盖面的全面性，同时避免过度拟合特定模式。

### 实验结果

![](https://pic3.zhimg.com/v2-11a83cb9187f3b55ead72d7a167ef4da_r.jpg)

BrowseComp达到了35.3分，相比DeepDive高出不少。

方法上，相比DeepDive，图谱构建方式不同，使用了真实网页信息；子图多样性看起来更好，覆盖了多种复杂拓扑结构；混淆方式里的**噪声注入**和**移除子图中的关键节点和边**，这两点是DeepDive没有的。

但同时训练集达到了30000+条，是DeepDive的10倍。可能数据质量和数量都带来了一定的增益。

  

## REDSearcher

[https://arxiv.org/pdf/2602.14234](https://link.zhihu.com/?target=https%3A//arxiv.org/pdf/2602.14234)

![](https://pic4.zhimg.com/v2-4178d8efe08e3edc1e6e0726013f7b93_r.jpg)

和WebSailor-V2类似，也是构建各种复杂拓扑结构的子图。通过定义[TreeWidth](https://zhida.zhihu.com/search?content_id=270459348&content_type=Article&match_order=1&q=TreeWidth&zhida_source=entity)来衡量图结构的复杂度。

此外，还定义了一个**信息分散度**的概念，衡量**覆盖全部关键证据所需的最小来源数**。信息分散度越大，证据越分散，Agent就越需要进行多轮的检索与综合，而不是搜索一两个页面就结束。

![](https://pica.zhimg.com/v2-a7e38064e254f7d77584c2d92dc6d4f2_r.jpg)

### QA Generation：

**1、图谱构建：**

结合了wiki和web两种方式。

**2、子图提取：**

构造满足指定treewidth + 分散度的推理图，利用一个LLM Agent做拓扑加密，让依赖图出现环、交错约束，逼着Agent从“顺藤摸瓜”变成“联合验证”。

**3、QA生成：**

和前面两个方法类似，也会对关键实体做模糊化处理，例如把地点名换成地图路程约束、把明确实体换成需要scholar/画像/属性检索才能落地的描述。

### Verifier Pipeline：

此外，还加入了一套Verifier Pipeline，来保证题“难、真、可解、答案唯一”，具体流程如下：

- **LLM 求解器预过滤（无工具）**：我们运行一个不具备工具访问权限的 LLM 求解器；如果它能正确回答，该实例会被视为挑战性不足并被移除。
- **可检索性检查（搜索片段）**：我们使用搜索引擎 API 查询问题；如果给定答案未出现在前 50 条结果的片段中，我们会将该实例过滤为开放网络检索支持较弱的实例。
- **幻觉 / 不一致性检查**：我们将构建过程中使用的接地证据（例如，知识库三元组和缓存段落）与最终问题一起提供给 LLM 验证器；存在明显矛盾的实例会被移除。
- **智能体展开验证**：我们运行一个强大的工具使用型智能体进行 n 次独立展开；如果至少有一次展开预测到了给定答案，则保留该实例，并将通过率记录为置信度信号。
- **答案唯一性检查**：在成功展开的基础上，我们进一步检查结果的解多重性。如果智能体合理地识别出有效的替代答案或满足查询约束的不同候选集，我们会丢弃这些实例。虽然这并非对唯一性的正式保证，但这种启发式过滤器通过移除求解器自然产生分歧的情况，显著降低了任务模糊或定义不明确的风险。

### 实验结果

![](https://pic1.zhimg.com/v2-fe55114002ca276cd6bf264dd3b89196_r.jpg)

BrowseComp达到了42.1分，相比WebSailor-V2进一步提高了6.8分。

QA的整个构建过程看起来和WebSailor-V2有些类似，**信息分散度是一个亮点。**此外，这个工作还引入了MidTrain阶段，存在多个变量（使用的Teacher模型、数据量），因此也不好严格去对比这两个数据合成方法的优劣。

值得一提的是，其通过Context Management，进一步提升了15.3分，达到了57.4，这个分数还是挺高的。

Context Management的方案是：一旦运行中的上下文超过窗口预算的预设阈值，就会重置上下文内的工具调用历史，同时保留原始问题q和最简任务规格说明。随后，Agent从全新的上下文重新启动轨迹展开。

个人感觉这就是一种Test-Time Scaling，如果超过阈值了，那大概率Agent陷入困境中了，这时候重来，有点做错重试的意思，所以指标高这么多看起来也合理。

## 总结

感觉WebSailor-V2和REDSearcher的这种方法是当前的一个最优方案，即**构建各种复杂拓扑结构的子图**，同时结合一些**模糊化策略**，例如：关键实体/属性模糊、噪声注入、子图关键节点/边移除，再加入像**信息分散度**这样的指标监控，就可以让生成的问题足够难，让Agent需要多轮检索和综合多种页面信息才能回答。
