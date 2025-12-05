// BTC 50单滑动窗口网格自动下单系统 - 完整优化版（2025最新）
class BTCAutoTrading {
    // ========== 基础交易配置 ==========
    static TRADING_CONFIG = {
        START_PRICE: 80000,
        END_PRICE: 100000,
        MIN_ORDER_INTERVAL: 2000,     // 下单最小间隔10秒（防风控）
        ORDER_COOLDOWN: 1500,          // 单个订单成功后冷却3秒
        MONITOR_INTERVAL: 3000,       // 主循环检查间隔（建议8~15秒）
        MAX_PROCESSED_ORDERS: 100,
        POSITION_CHECK_DELAY: 2000,
        MAX_POSITION_CHECKS: 60,
        UI_OPERATION_DELAY: 500,
        PRICE_UPDATE_DELAY: 1500,
        ORDER_SUBMIT_DELAY: 1500,
        CLOSE_POSITION_CYCLE: 30      
    };

    // ========== 网格策略核心配置（全部集中在这里调参！）==========
    static GRID_STRATEGY_CONFIG = {
        TOTAL_ORDERS: 12,               // 固定50单滑动窗口

        // 窗口宽度（核心参数！建议 0.08~0.18）
        WINDOW_PERCENT: 0.12,           // 12% → 7万时 ≈ ±4200美元范围

        // 买卖单比例（总和必须为1，可根据牛熊调整）
        SELL_RATIO: 0.5,               // 55% ≈ 27~28个卖单（适合震荡偏多）
        BUY_RATIO:  0.5,               // 45% ≈ 22~23个买单

        // 网格间距
        BASE_PRICE_INTERVAL: 20,        // 基础间距（会自动微调保证填满单数）
        SAFE_GAP: 20,                   // 比当前盘口再偏移一点，防止瞬成

        // 安全保护
        MAX_DRIFT_BUFFER: 2000,         // 超出窗口太多自动停止扩展
        MIN_VALID_PRICE: 10000,         // 防止崩盘挂到地板价
        MAX_MULTIPLIER: 15,         // 动态开仓大小的比例最大开仓倍数

        // --- 策略配置 ---
        RSI_MIN: 35,                   // RSI 下限
        RSI_MAX: 65,                    // RSI 上限
        ADX_TREND_THRESHOLD: 25,                   // ADX 下限
        ADX_STRONG_TREND: 30                   // ADX 下限
    };

    // ========== 页面元素选择器 ==========
    static SELECTORS = {
        ASK_PRICE: 'span[data-testid="ask-price-display"]',
        BID_PRICE: 'span[data-testid="bid-price-display"]',
        QUANTITY_INPUT: 'input[data-testid="quantity-input"]',
        PRICE_INPUT: 'input[data-testid="limit-price-input"]',
        SUBMIT_BUTTON: 'button[data-testid="submit-button"]',
        ORDERS_TABLE_ROW: '[data-testid="orders-table-row"]',
        RED_ELEMENTS: '.text-red',
        GREEN_ELEMENTS: '.text-green',
        TEXT_CURRENT: '[class*="text-current"]'
    };

    // ========== 文本与类名匹配 ==========
    static TEXT_MATCH = {
        PENDING_ORDERS: ['未成交订单', 'Pending Orders', 'Open Orders'],
        LIMIT_BUTTON: ['限价', 'limit'],
        BUY_BUTTON: ['买', 'Buy'],
        SELL_BUTTON: ['卖', 'Sell']
    };

    static CLASS_MATCH = {
        LIMIT_BUTTON: ['p-0', 'text-center'],
        BUY_BUTTON: 'bg-green',
        SELL_BUTTON: 'bg-red'
    };

    constructor() {
        this.orderManager = new BTCOrderManager();
        this.isMonitoring = false;
        this.monitorInterval = null;
        this.tradingEnabled = false;
        this.processedOrders = new Set();
        this.lastOrderTime = 0;
        this.cycleCount = 0;
        this.isPrepared = false;

        this.minOrderInterval = BTCAutoTrading.TRADING_CONFIG.MIN_ORDER_INTERVAL;
    }

    // ==================== 准备交易环境 ====================
    async prepareTradingEnvironment() {
        try {
            // 1. 点击"未成交订单"
            const pendingTab = this.findPendingOrdersTab();
            if (pendingTab) {
                pendingTab.click();
                await this.delay(BTCAutoTrading.TRADING_CONFIG.UI_OPERATION_DELAY);
            }

            // 2. 点击"限价"
            await this.clickLimitButton();
            await this.delay(BTCAutoTrading.TRADING_CONFIG.UI_OPERATION_DELAY * 2);

            // 3. 等待仓位设置
            await this.checkAndWaitForPositionSize();

            this.isPrepared = true;
            return true;
        } catch (err) {
            console.error('交易环境准备失败:', err);
            return false;
        }
    }

    findPendingOrdersTab() {
        return Array.from(document.querySelectorAll('span')).find(el =>
            BTCAutoTrading.TEXT_MATCH.PENDING_ORDERS.some(t => el.textContent.includes(t))
        );
    }

    async clickLimitButton() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const limitBtn = buttons.find(btn =>
            BTCAutoTrading.TEXT_MATCH.LIMIT_BUTTON.some(t =>
                btn.textContent.toLowerCase().includes(t.toLowerCase())
            )
        ) || buttons.find(btn =>
            BTCAutoTrading.CLASS_MATCH.LIMIT_BUTTON.every(c => btn.className.includes(c))
        );

        if (limitBtn) {
            limitBtn.click();
            await this.delay(BTCAutoTrading.TRADING_CONFIG.UI_OPERATION_DELAY);
            return true;
        }
        console.log('未找到限价按钮，继续...');
        return false;
    }

    async checkAndWaitForPositionSize() {
        let checks = 0;
        while (checks < BTCAutoTrading.TRADING_CONFIG.MAX_POSITION_CHECKS) {
            const input = document.querySelector(BTCAutoTrading.SELECTORS.QUANTITY_INPUT);
            if (input && parseFloat(input.value) > 0) {
                console.log(`仓位已设置: ${input.value}`);
                return true;
            }
            checks++;
            console.error('请先手动设置仓位数量！');
            await this.delay(BTCAutoTrading.TRADING_CONFIG.POSITION_CHECK_DELAY);
        }
        console.error('超时：请先手动设置仓位数量！');
        this.showWarningMessage('请先在数量框输入开仓大小！');
        return false;
    }

    async getTradeInfo() {
        // 获取仓位
        let position = '0';  // 默认设为0
        const xpath = "//*[contains(text(), '仓位') or contains(text(), 'Position')]";
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        
        for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i);
            const btcEl = node.parentElement.querySelector('.text-blackwhite');
            if (btcEl && btcEl.textContent.includes('BTC')) {
                position = btcEl.textContent.trim().replace(/[^\d.-]/g, '');
                break;
            }
        }
        
        // 获取开仓大小
        const input = document.querySelector('input[data-testid="quantity-input"]');
        const orderSizeText = input ? (input.value || input.placeholder || '0') : '0';
        const orderSize = parseFloat(orderSizeText.replace(/[^\d.]/g, '')) ; // 默认值
        
        // 转换为数字
        const positionBTC = parseFloat(position) || 0;
        
        console.log(`当前仓位: ${positionBTC.toFixed(4)} BTC`);
        console.log(`开仓大小: ${orderSize}`);
        return {positionBTC, orderSize};  // 返回数字类型
    }


    // ==================== 主控方法 ====================
    async startAutoTrading(interval = BTCAutoTrading.TRADING_CONFIG.MONITOR_INTERVAL) {
        if (this.isMonitoring) return console.log('已在运行');

        const ready = await this.prepareTradingEnvironment();
        if (!ready) return console.error('环境准备失败，无法启动');

        this.isMonitoring = true;
        this.tradingEnabled = true;
        this.cycleCount = 0;
        console.log('BTC 50单网格自动交易已启动');
        console.log('脚本免费开源，作者推特@ddazmon');
        console.log('用谁的邀请码不是用，欢迎兄弟们使用邀请码，点返金额原路返回：');
        console.log('OMNINU3G7KVK');
        console.log('OMNIBGZ4ETT9');

        // 改用递归的setTimeout确保不重叠
        const executeWithInterval = async () => {
            if (!this.isMonitoring) return;
            
            const startTime = Date.now();
            await this.executeTradingCycle();
            const endTime = Date.now();
            const executionTime = endTime - startTime;
            
            // 计算下一次执行的延迟
            const nextDelay = Math.max(interval - executionTime, 1000); // 最少等待1秒
            
            if (this.isMonitoring) {
                setTimeout(executeWithInterval, nextDelay);
            }
        };
        
        // 立即开始第一个周期
        executeWithInterval();
    }

    stopAutoTrading() {
        this.isMonitoring = false;
        this.tradingEnabled = false;
        clearInterval(this.monitorInterval);
        this.monitorInterval = null;
        console.log('自动交易已停止');
    }

    // ==================== 核心交易周期 ====================
    async executeTradingCycle() {
        if (!this.tradingEnabled) return;
        this.cycleCount++
        console.log(`\n[${new Date().toLocaleTimeString()}] 第${this.cycleCount}次循环`);

        // --- RSI 检查逻辑 ---
        try {
            const indicators = await this.getIndicatorsFromChart();
            
            if (indicators && typeof indicators.rsi === 'number' && typeof indicators.adx === 'number') {
                const { rsi, adx } = indicators;
                const { RSI_MIN, RSI_MAX,ADX_TREND_THRESHOLD,ADX_STRONG_TREND } = BTCAutoTrading.GRID_STRATEGY_CONFIG;
                
                
                console.log(`%c当前指标 - RSI: ${rsi.toFixed(2)}, ADX: ${adx.toFixed(2)}`, 
                           "color: #ff9800; font-weight: bold; font-size: 14px;");
                
                // 情况1: 强趋势市场 - 不适合网格交易
                if (adx > ADX_STRONG_TREND) {
                    console.log(`%c[停止] ADX(${adx.toFixed(2)}) > ${ADX_STRONG_TREND}，市场处于强趋势行情，不适合网格策略。关闭所有仓位。`, 
                               "color: red; font-weight: bold;");
                    await this.cancelAllOrder();
                    await this.simpleClosePosition();
                    // await this.cancelAllOrder();
                    return;
                }
                
                // 情况2: 中等趋势市场 - 谨慎操作
                if (adx > ADX_TREND_THRESHOLD) {
                    console.log(`%c[警告] ADX(${adx.toFixed(2)}) > ${ADX_TREND_THRESHOLD}，市场存在趋势。`, 
                               "color: orange;");
                    
                    // 在趋势市场中，需要更严格的RSI控制
                    const TREND_RSI_TOLERANCE = 5; // 收紧RSI容忍度
                    
                    // 如果RSI显示极端超买/超卖，暂停操作
                    if (rsi < (RSI_MIN - TREND_RSI_TOLERANCE) || rsi > (RSI_MAX + TREND_RSI_TOLERANCE)) {
                        console.log(`%c[暂停] 趋势市场中RSI(${rsi.toFixed(2)})过于极端，暂停操作。`, 
                                   "color: orange;");
                        await this.cancelAllOrder();
                        await this.simpleClosePosition();
                        // await this.cancelAllOrder();
                        return;
                    }
                    
                    console.log(`%c[谨慎允许] 趋势市场但RSI在可控范围内，执行谨慎网格策略。`, 
                               "color: #ff9800;");
                    // 可以继续执行网格，但可能需要调整参数（如减少仓位）
                }
                // 情况3: 震荡市场 - 最适合网格交易
                else {
                    console.log(`%c[理想] ADX(${adx.toFixed(2)}) < ${ADX_TREND_THRESHOLD}，市场处于震荡行情，适合网格策略。`, 
                               "color: #4CAF50;");
                    
                    // 检查RSI是否在震荡区间内
                    if (rsi < RSI_MIN || rsi > RSI_MAX) {
                        console.log(`%c[等待] RSI(${rsi.toFixed(2)})不在${RSI_MIN}-${RSI_MAX}区间，暂停操作等待回归。`, 
                                   "color: red;");
                        await this.cancelAllOrder();
                        await this.simpleClosePosition();
                        return;
                    }
                    
                    console.log(`%c[允许] 震荡市场且RSI在区间内，执行标准网格策略。`, 
                               "color: green; font-weight: bold;");
                }
                
                
            } else {
                console.warn("未能获取完整的指标数据，请到推特@ddazmon查看使用教程");
                // 根据您的风险偏好，可以选择：
                // 1. 保守：关闭仓位并返回
                await this.cancelAllOrder();
                await this.simpleClosePosition();
                // await this.cancelAllOrder();
                return;
            }
        } catch (e) {
            console.error("读取图表指标失败:", e);
            // 发生错误时，为了安全建议关闭仓位
            await this.cancelAllOrder();
            await this.simpleClosePosition();
            return;
        }


        const ready = await this.prepareTradingEnvironment();
        if (!ready) return console.error('环境异常');
        try {
            const marketData = await this.getCompleteMarketData();
            if (!marketData.askPrice || !marketData.bidPrice) {
                console.log('无法读取价格，跳过');
                return;
            }

            const result = await this.calculateTargetPrices(marketData);
            console.log('计算订单结果：',result);

            // 新增：自动撤销最远的旧单
            if (result.cancelOrders && result.cancelOrders.length > 0) {
                console.log(`开始撤销 ${result.cancelOrders.length} 个远单...`);
                for (const order of result.cancelOrders) {
                    await this.orderManager.cancelByPrice(order.price);  // 添加 await
                    await this.delay(500);  // 撤单后等待1.5秒
                }
            }
             // 4. 重要：撤单后等待并重新获取订单状态
            const updatedMarketData = await this.getCompleteMarketData();
            
            // 5. 基于新状态重新计算要下的订单
            const updatedResult = await this.calculateTargetPrices(updatedMarketData);

            // 6. 执行下单
            if (updatedResult.buyPrices.length > 0 || updatedResult.sellPrices.length > 0) {
                await this.executeSafeBatchOrders(
                    updatedResult.buyPrices, 
                    updatedResult.sellPrices, 
                    updatedMarketData
                );
            }


        } catch (err) {
            console.error('周期执行异常:', err);
        }

    }

    async cancelAllOrder() {
        console.log('准备关闭所有仓位');
        const ready = await this.prepareTradingEnvironment();
        if (!ready) return console.error('环境准备失败，无法启动');

        const marketData = await this.getCompleteMarketData();
        if (!marketData.askPrice || !marketData.bidPrice) {
            console.log('无法读取价格，跳过');
            return;
        }
        const { askPrice, bidPrice, existingSellOrders = [], existingBuyOrders = [] } = marketData;

        console.log('关闭所有卖单');
        if (existingSellOrders && existingSellOrders.length > 0) {
            console.log(`开始撤销 ${existingSellOrders.length} 个卖单...`);
            for (const order of existingSellOrders) {
                await this.orderManager.cancelByPrice(order);  // 添加 await
                await this.delay(500);  // 撤单后等待1.5秒
            }
        }
        console.log('关闭所有买单');
        if (existingBuyOrders && existingBuyOrders.length > 0) {
            console.log(`开始撤销 ${existingBuyOrders.length} 个买单...`);
            for (const order of existingBuyOrders) {
                await this.orderManager.cancelByPrice(order);  // 添加 await
                await this.delay(500);  // 撤单后等待1.5秒
            }
        }

    }

    // 更简洁的辅助函数版本
    async simpleClosePosition() {
        console.log('开始关闭仓位操作...');
        
        // 查找"仓位"文本
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    return node.textContent.trim() === '仓位' ? 
                        NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            }
        );
        
        const positionNode = walker.nextNode();
        if (positionNode && positionNode.parentElement) {
            console.log('点击仓位元素...');
            positionNode.parentElement.click();
        } else {
            console.error('找不到仓位元素');
            return;
        }
        
        setTimeout(() => {
            // 查找"关闭"按钮
            const closeBtns = document.querySelectorAll('button');
            const closeBtn = Array.from(closeBtns).find(btn => 
                btn.textContent.trim() === '关闭' || 
                btn.textContent.includes('关闭')
            );
            
            if (closeBtn) {
                console.log('点击关闭按钮...');
                closeBtn.click();
            } else {
                console.error('没有持仓，跳过');
                return;
            }
            
            setTimeout(() => {
                // 查找"卖出平仓"按钮
                const sellBtns = document.querySelectorAll('button');
                const sellBtn = Array.from(sellBtns).find(btn => 
                    btn.textContent.includes('卖出平仓') || 
                    btn.textContent.includes('平仓')
                );
                
                if (sellBtn) {
                    console.log('点击卖出平仓按钮...');
                    sellBtn.click();
                    console.log('✅ 操作完成！');
                } else {
                    console.error('找不到卖出平仓按钮');
                }
            }, 1000);
        }, 1000);

    }


    // ==================== 2. RSI 读取模块 (新增) ====================
    async getIndicatorsFromChart() {
        const iframe = document.querySelector('iframe');
        if (!iframe) {
            console.warn('未找到 TradingView iframe');
            return null;
        }

        // 检查 iframe 是否跨域（如果跨域将无法读取，这是浏览器安全限制）
        try {
            const doc = iframe.contentDocument;
            if (!doc) return null; // 无法访问
        } catch (e) {
            console.error('无法访问 iframe 内容，可能是跨域限制:', e);
            return null;
        }

        return new Promise((resolve) => {
            const doc = iframe.contentDocument;
            const valueElements = doc.querySelectorAll('div[class*="valueValue"]'); // 使用模糊匹配以防 hash 变动
            
            if (valueElements.length === 0) {
                resolve(null);
                return;
            }

            let result = { currentPrice: null, ema9: null, ema21: null, rsi: null, adx: null };

            valueElements.forEach(element => {
                const valueText = element.textContent.trim();
                const color = window.getComputedStyle(element).color; // 获取计算后的颜色
                const parent = element.parentElement;
                // 尝试找标题
                const titleEl = parent?.querySelector('div[class*="valueTitle"]');
                const title = titleEl ? titleEl.textContent.trim() : '';

                // 移除逗号并转数字
                const val = parseFloat(valueText.replace(/,/g, ''));

                // 根据你的脚本逻辑匹配颜色和标题
                if (title === 'C' || title === '收盘') {
                    result.currentPrice = val;
                } 
                // 注意：颜色的格式可能是 'rgb(r, g, b)'，需要根据实际情况匹配
                // 这里使用你提供的颜色逻辑
                else if (color.includes('33, 150, 243')) { // 蓝色
                    result.ema9 = val;
                } else if (color.includes('255, 235, 59')) { // 黄色
                    result.ema21 = val;
                } else if (color.includes('126, 87, 194') || title === 'RSI') { // 紫色或标题为RSI
                    result.rsi = val;
                } else if (color.includes('255, 82, 82') || title === 'ADX') { // 紫色或标题为ADX
                    result.adx = val;
                }
            });
            console.log('指标：',resolve(result));
            resolve(result);
        });
    }


    // ==================== 获取市场数据 ====================
    async getCompleteMarketData() {
        const askEl = document.querySelector(BTCAutoTrading.SELECTORS.ASK_PRICE);
        const bidEl = document.querySelector(BTCAutoTrading.SELECTORS.BID_PRICE);

        if (!askEl || !bidEl) return { askPrice: null, bidPrice: null, existingSellOrders: [], existingBuyOrders: [] };

        const askPrice = parseFloat(askEl.textContent.replace(/[$,]/g, ''));
        const bidPrice = parseFloat(bidEl.textContent.replace(/[$,]/g, ''));

        await this.delay(BTCAutoTrading.TRADING_CONFIG.PRICE_UPDATE_DELAY);

        const rows = document.querySelectorAll(BTCAutoTrading.SELECTORS.ORDERS_TABLE_ROW);
        const existingSell = new Set();
        const existingBuy = new Set();

        rows.forEach(row => {
            const isSell = row.querySelectorAll(BTCAutoTrading.SELECTORS.RED_ELEMENTS).length > 0;
            const isBuy = row.querySelectorAll(BTCAutoTrading.SELECTORS.GREEN_ELEMENTS).length > 0;
            if (!isSell && !isBuy) return;

            const priceTexts = Array.from(row.querySelectorAll(BTCAutoTrading.SELECTORS.TEXT_CURRENT))
                .map(el => el.textContent.trim())
                .filter(t => t.includes('$') && !t.includes('Q'));
            if (priceTexts.length === 0) return;

            const price = parseFloat(priceTexts[0].replace(/[$,]/g, ''));
            if (price > 0) {
                if (isSell) existingSell.add(price);
                if (isBuy) existingBuy.add(price);
            }
        });

        return {
            askPrice,
            bidPrice,
            existingSellOrders: Array.from(existingSell).sort((a, b) => a - b),
            existingBuyOrders: Array.from(existingBuy).sort((a, b) => b - a)
        };
    }

    // ==================== 计算目标价格================
    async calculateTargetPrices(marketData) {
        const { askPrice, bidPrice, existingSellOrders = [], existingBuyOrders = [] } = marketData;
        const cfg = BTCAutoTrading.GRID_STRATEGY_CONFIG;

        const midPrice = (askPrice + bidPrice) / 2;
        const windowSize = midPrice * cfg.WINDOW_PERCENT;
        const halfWindow = windowSize / 2;
        const interval = cfg.BASE_PRICE_INTERVAL;  // 统一买卖间隔

        // ========== 核心逻辑：根据持仓比例动态调整买卖比例 ==========
        const tradeInfo = await this.getTradeInfo();  // 添加 await
        const positionBTC = tradeInfo.positionBTC || 0;
        const orderSize = tradeInfo.orderSize || 0;
        const MAX_MULTIPLIER = cfg.MAX_MULTIPLIER;       
        
        // 添加安全检查和默认值
        const safeOrderSize = Math.max(orderSize, 0.0001);  // 防止除零
        const positionMultiplier = Math.abs(positionBTC) / safeOrderSize;
        
        // 基础买卖比例
        const baseSellRatio = cfg.SELL_RATIO;  // 假设0.55
        const baseBuyRatio = 1 - baseSellRatio;  // 0.45
        
        let finalSellRatio = baseSellRatio;
        let finalBuyRatio = baseBuyRatio;
        
        console.log(`当前持仓: ${positionBTC.toFixed(4)} BTC | 相对于开仓大小的倍数: ${positionMultiplier.toFixed(1)}x`);
        
        // 逻辑1：持仓达到上限时，完全停止同方向开单
        if (positionMultiplier >= MAX_MULTIPLIER) {
            if (positionBTC > 0) {
                // 多单达到上限，完全不开多单
                console.log(`⚠️ 多单已达上限(${MAX_MULTIPLIER}x)，停止开多单`);
                finalBuyRatio = 0;
                finalSellRatio = 1;
            } else if (positionBTC < 0) {
                // 空单达到上限，完全不开空单
                console.log(`⚠️ 空单已达上限(${MAX_MULTIPLIER}x)，停止开空单`);
                finalBuyRatio = 1;
                finalSellRatio = 0;
            }
        } 
        // 逻辑2：持仓较大时，按比例减少同方向开单
        else if (positionMultiplier > 0) {
            // 计算减少比例（持仓越多，减少越多）
            const reductionRatio = positionMultiplier / MAX_MULTIPLIER;  // 0到1之间
            
            if (positionBTC > 0) {
                // 多单持仓，减少买单比例，增加卖单比例
                const buyReduction = reductionRatio * baseBuyRatio;
                finalBuyRatio = Math.max(0, baseBuyRatio - buyReduction);
                finalSellRatio = 1 - finalBuyRatio;
                console.log(`调整后比例: 卖单 ${(finalSellRatio*100).toFixed(0)}% / 买单 ${(finalBuyRatio*100).toFixed(0)}%`);
            } else if (positionBTC < 0) {
                // 空单持仓，减少卖单比例，增加买单比例
                const sellReduction = reductionRatio * baseSellRatio;
                finalSellRatio = Math.max(0, baseSellRatio - sellReduction);
                finalBuyRatio = 1 - finalSellRatio;
                console.log(`调整后比例: 卖单 ${(finalSellRatio*100).toFixed(0)}% / 买单 ${(finalBuyRatio*100).toFixed(0)}%`);
            }
        }
        
        // 确保比例在合理范围内（10%-90%之间）
        finalBuyRatio = Math.max(0.1, Math.min(0.9, finalBuyRatio));
        finalSellRatio = Math.max(0.1, Math.min(0.9, finalSellRatio));
        
        // 计算买卖订单数量
        const sellCount = Math.round(cfg.TOTAL_ORDERS * finalSellRatio);
        const buyCount = cfg.TOTAL_ORDERS - sellCount;                // 目标买单数 ≈22~23

        // ========== 1. 计算当前窗口内"应该存在的理想订单" ==========
        const sellStart = Math.ceil((askPrice + cfg.SAFE_GAP) / interval) * interval;
        const idealSellPrices = [];
        for (let i = 0; i < sellCount; i++) {
            const p = sellStart + i * interval;
            if (p > midPrice + halfWindow + cfg.MAX_DRIFT_BUFFER) break;
            idealSellPrices.push(p);
        }

        const buyEnd = Math.floor((bidPrice - cfg.SAFE_GAP) / interval) * interval;
        const idealBuyPrices = [];
        for (let i = 0; i < buyCount; i++) {
            const p = buyEnd - i * interval;
            if (p < midPrice - halfWindow - cfg.MAX_DRIFT_BUFFER) break;
            if (p < cfg.MIN_VALID_PRICE) break;
            idealBuyPrices.push(p);
        }

        const idealPricesSet = new Set([...idealSellPrices, ...idealBuyPrices]);

        // ========== 2. 计算需要下的新单 ==========
        const newSellPrices = idealSellPrices.filter(p => !existingSellOrders.includes(p));
        const newBuyPrices  = idealBuyPrices.filter(p => !existingBuyOrders.includes(p));

        // ========== 3. 计算需要撤销的旧单（超出当前窗口的）==========
        const currentTotal = existingSellOrders.length + existingBuyOrders.length;
        const ordersToCancel = [];

        if (currentTotal > cfg.TOTAL_ORDERS || existingSellOrders.length > sellCount || existingBuyOrders.length > buyCount) {
            // 优先撤销最远的卖单（价格最高的）
            const farSellOrders = existingSellOrders
                .filter(p => !idealPricesSet.has(p))
                .sort((a, b) => b - a);  // 从高到低

            // 优先撤销最远的买单（价格最低的）
            const farBuyOrders = existingBuyOrders
                .filter(p => !idealPricesSet.has(p))
                .sort((a, b) => a - b);  // 从低到高

            // 合并并取最远的若干个，直到总单数回到50以内
            const allFar = [
                ...farSellOrders.map(p => ({ type: 'sell', price: p })),
                ...farBuyOrders.map(p => ({ type: 'buy', price: p }))
            ];

            // 按与中间价距离排序，越远越先撤
            allFar.sort((a, b) => Math.abs(b.price - midPrice) - Math.abs(a.price - midPrice));

            const excess = currentTotal - cfg.TOTAL_ORDERS;
            for (let i = 0; i < Math.max(excess, allFar.length); i++) {
                if (ordersToCancel.length >= 10) break; // 单次最多撤10单，防误操作
                ordersToCancel.push(allFar[i]);
            }
        }

        console.log(`中间价 $${midPrice.toFixed(1)} | 窗口 ±${halfWindow.toFixed(0)}`);
        console.log(`当前订单: ${existingSellOrders.length}卖 + ${existingBuyOrders.length}买 = ${currentTotal}`);
        console.log(`目标订单: ${idealSellPrices.length}卖 + ${idealBuyPrices.length}买`);
        console.log(`需下单: ${newSellPrices.length}卖 + ${newBuyPrices.length}买`);
        if (ordersToCancel.length > 0) {
            console.log(`需撤销: ${ordersToCancel.length}单 →`, ordersToCancel.map(o => `${o.type}-${o.price}`).join(', '));
        } else {
            console.log(`无需撤销订单`);
        }

        return {
            sellPrices: newSellPrices,
            buyPrices:  newBuyPrices,
            cancelOrders: ordersToCancel  // 新增：返回要撤销的订单列表
        };
    }

    // ==================== 安全批量下单 ====================
    async executeSafeBatchOrders(buyPrices, sellPrices, marketData) {
        const orders = [
            ...buyPrices.map(p => ({ type: 'buy', price: p })),
            ...sellPrices.map(p => ({ type: 'sell', price: p }))
        ];

        console.log(`新单:`,orders);
        for (const order of orders) {
            const success = order.type === 'buy'
                ? await this.orderManager.placeLimitBuy(order.price)
                : await this.orderManager.placeLimitSell(order.price);

            if (success) {
                this.lastOrderTime = Date.now();
                await this.delay(BTCAutoTrading.TRADING_CONFIG.ORDER_COOLDOWN);
            }
        }
        console.log('本轮下单完成');
    }

    // ==================== 工具方法 ====================
    clearOrderHistory() {
        this.processedOrders.clear();
        this.lastOrderTime = 0;
        this.cycleCount = 0;
        console.log('订单记录已清空');
    }

    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            cycleCount: this.cycleCount,
            processedCount: this.processedOrders.size,
            lastOrderTime: this.lastOrderTime ? new Date(this.lastOrderTime).toLocaleTimeString() : '无',
            nextClosePositionCycle: BTCAutoTrading.TRADING_CONFIG.CLOSE_POSITION_CYCLE - (this.cycleCount % BTCAutoTrading.TRADING_CONFIG.CLOSE_POSITION_CYCLE)
        };
    }

    showWarningMessage(msg) {
        alert(`警告：${msg}`);
        console.warn(`警告：${msg}`);
    }

    delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

// ==================== 下单管理器 ====================
class BTCOrderManager {
    static CONFIG = { UI_OPERATION_DELAY: 500, INPUT_DELAY: 300, ORDER_SUBMIT_DELAY: 1000 };

    async placeLimitBuy(price) {
        return await this.placeOrder(price, 'buy');
    }

    async placeLimitSell(price) {
        return await this.placeOrder(price, 'sell');
    }

    async placeOrder(price, type) {
        console.warn(`placeOrder：`,price, type);
        try {
            const button = type === 'buy' ? this.findBuyButton() : this.findSellButton();
            if (!button) return false;
            button.click();

            await this.delay(BTCOrderManager.CONFIG.UI_OPERATION_DELAY);

            const priceInput = document.querySelector(BTCAutoTrading.SELECTORS.PRICE_INPUT);
            if (!priceInput) return false;

            priceInput.value = price;
            priceInput.dispatchEvent(new Event('input', { bubbles: true }));
            // priceInput.dispatchEvent(new Event('change', { bubbles: true }));

            await this.delay(BTCOrderManager.CONFIG.INPUT_DELAY);

            const submit = document.querySelector(BTCAutoTrading.SELECTORS.SUBMIT_BUTTON);
            if (!submit || submit.disabled) return false;
            submit.click();

            return true;
        } catch (err) {
            console.error('下单异常:', err);
            return false;
        }
    }

    findBuyButton() { return this.findDirectionButton('buy'); }
    findSellButton() { return this.findDirectionButton('sell'); }

    findDirectionButton(dir) {
        const isBuy = dir === 'buy';
        if (isBuy) {
            // 买单按钮对应的价格显示是ask-price
            const askPriceElement = document.querySelector('span[data-testid="ask-price-display"]');
            if (askPriceElement) {
                const buyButton = askPriceElement.closest('button');
                if (buyButton && buyButton.textContent.includes('买')) {
                    return buyButton;
                }
            }
        } else {
            // 卖单按钮对应的价格显示是bid-price
            const bidPriceElement = document.querySelector('span[data-testid="bid-price-display"]');
            if (bidPriceElement) {
                const sellButton = bidPriceElement.closest('button');
                if (sellButton && sellButton.textContent.includes('卖')) {
                    return sellButton;
                }
            }
        }
    }

    async getCurrentPrice() {
        const askEl = document.querySelector(BTCAutoTrading.SELECTORS.ASK_PRICE);
        const bidEl = document.querySelector(BTCAutoTrading.SELECTORS.BID_PRICE);
        
        if (!askEl || !bidEl) return null;
        
        const askPrice = parseFloat(askEl.textContent.replace(/[$,]/g, ''));
        const bidPrice = parseFloat(bidEl.textContent.replace(/[$,]/g, ''));
        
        return (askPrice + bidPrice) / 2;
    }

    async cancelByPrice(price) {
        console.log(`准备取消 $${price}`);
        const currentPrice = await this.getCurrentPrice();
        if (currentPrice) {
            const prices = Array.isArray(price) ? price : [price];
            const shouldSkip = prices.some(targetPrice => {
                const targetNum = Number(String(targetPrice).replace(/[^0-9.]/g, ''));
                if (!targetNum) return false;
                
                const cfg = BTCAutoTrading.GRID_STRATEGY_CONFIG;
                const priceDiff = Math.abs(targetNum - currentPrice);
                const isNearCurrentPrice = priceDiff <= cfg.BASE_PRICE_INTERVAL;
                
                if (isNearCurrentPrice) {
                    console.log(`跳过撤单：价格接近当前价格 (差值: ${priceDiff.toFixed(1)})`);
                }
                return isNearCurrentPrice;
            });
            
            if (shouldSkip) return;
        }
      const prices = Array.isArray(price) ? price : [price];
      
      for (let target of prices) {
        const targetNum = Number(String(target).replace(/[^0-9.]/g, ''));
        if (!targetNum) continue;

        const allPriceSpans = document.querySelectorAll('div.justify-self-end > span.text-current');

        let found = false;
        for (const span of allPriceSpans) {
          const text = span.textContent.trim();
          const priceInPage = Number(text.replace(/[$,]/g, ''));
          
          if (priceInPage === targetNum) {
            const row = span.closest('[data-testid="orders-table-row"]');
            const cancelBtn = row?.querySelector('button[title="取消订单"]');
            
            if (cancelBtn) {
              cancelBtn.scrollIntoView({ block: 'center' });
              cancelBtn.click();

              await new Promise(resolve => {
                let attempts = 0;
                const timer = setInterval(() => {
                  attempts++;
                  
                  // 多种方式查找确认按钮
                  const confirmBtn = 
                    // 方式1：通过类名和文本内容
                    [...document.querySelectorAll('button')].find(btn => 
                      btn.textContent.trim() === '确认' && 
                      btn.classList.contains('bg-red')
                    ) ||
                    // 方式2：通过autofocus属性
                    document.querySelector('button[autofocus]') ||
                    // 方式3：通过精确的类名组合
                    document.querySelector('button.bg-red.h-8.px-3.py-1.text-xs.rounded-md') ||
                    // 方式4：通过文本内容（宽松匹配）
                    [...document.querySelectorAll('button')].find(btn => 
                      btn.textContent.includes('确认')
                    );

                  if (confirmBtn && confirmBtn.offsetParent !== null) {
                    clearInterval(timer);
                    setTimeout(() => {
                      confirmBtn.click();
                      console.log(`已确认取消 $${targetNum.toLocaleString()}`);
                      resolve();
                    }, 300); // 稍微延长等待时间
                  }

                  if (attempts > 50) {
                    clearInterval(timer);
                    console.warn('确认按钮超时，可能弹窗被拦截或已自动关闭');
                    resolve();
                  }
                }, 300);
              });

              found = true;
              break;
            }
          }
        }

        if (!found) {
          console.warn(`未找到 $${targetNum.toLocaleString()} 的挂单（或已被取消）`);
        }

        await new Promise(r => setTimeout(r, 1000));
      }

    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ==================== 全局实例 ====================
const btcAutoTrader = new BTCAutoTrading();

// ==================== 快捷指令（直接粘到控制台使用）===================
// btcAutoTrader.stopAutoTrading();         // 停止
// btcAutoTrader.getStatus();               // 查看状态（现在会显示距离下次清仓的剩余循环数）
// btcAutoTrader.clearOrderHistory();       // 清空记录
// btcAutoTrader.cancelAllOrder();       // 关闭所有挂单

// 建议第一次运行前先手动设置好仓位数量，然后执行：
// btcAutoTrader.startAutoTrading(3000);