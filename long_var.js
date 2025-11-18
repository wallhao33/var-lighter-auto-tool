(function() {
    'use strict';
    
    // ========== 参数配置区域 ==========
    const CONFIG = {
        // 执行控制
        isRunning: true,
        iteration: 0,
        
        // 时间配置
        sleepAfterLong: 1650000, // 开多仓后休眠时间(毫秒) - 100秒 = 600000毫秒
        waitBeforeRetry: 1000,  // 重试前等待时间(毫秒)
        uiUpdateDelay: 500,     // UI更新等待时间(毫秒)
        
        // 重试配置
        longMaxRetries: 99,      // 开多仓最大重试次数
        shortMaxRetries: 99,    // 开空仓最大重试次数
        
        // 按钮文本配置
        longButtonText: '买',   // 开多仓按钮文字
        shortButtonText: '卖',  // 开空仓按钮文字
        
        // 选择器配置
        submitButtonSelector: 'button[data-testid="submit-button"]'
    };
    // ========== 参数配置结束 ==========
    
    function formatTime(date) {
        return date.toTimeString().split(' ')[0];
    }
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // 查找并点击开多仓按钮
    function clickLongButton() {
        const longButtons = Array.from(document.querySelectorAll('button'));
        const longButton = longButtons.find(btn => {
            const span = btn.querySelector('span');
            return span && span.textContent.includes(CONFIG.longButtonText) && btn.querySelector('svg');
        });
        
        if (longButton) {
            longButton.click();
            console.log('已点击开多仓按钮');
            return true;
        }
        return false;
    }
    
    // 查找并点击开空仓按钮
    function clickShortButton() {
        const shortButtons = Array.from(document.querySelectorAll('button'));
        const shortButton = shortButtons.find(btn => {
            const span = btn.querySelector('span');
            return span && span.textContent.includes(CONFIG.shortButtonText) && btn.querySelector('svg');
        });
        
        if (shortButton) {
            shortButton.click();
            console.log('已点击开空仓按钮');
            return true;
        }
        return false;
    }
    
    // 查找并点击提交按钮
    function clickSubmitButton() {
        const submitButtons = Array.from(document.querySelectorAll(CONFIG.submitButtonSelector));
        const submitButton = submitButtons.find(btn => {
            return btn.textContent.includes(CONFIG.longButtonText) || btn.textContent.includes(CONFIG.shortButtonText);
        });
        
        if (submitButton && !submitButton.disabled) {
            submitButton.click();
            console.log('已点击提交按钮');
            return true;
        } else if (submitButton && submitButton.disabled) {
            console.log('提交按钮当前不可用');
            return false;
        }
        return false;
    }
    
    // 获取当前交易对名称
    function getTradingPair() {
        const submitButtons = Array.from(document.querySelectorAll(CONFIG.submitButtonSelector));
        const submitButton = submitButtons.find(btn => {
            return btn.textContent.includes(CONFIG.longButtonText) || btn.textContent.includes(CONFIG.shortButtonText);
        });
        
        if (submitButton) {
            const text = submitButton.textContent.trim();
            const pair = text.replace(new RegExp(`[${CONFIG.longButtonText}${CONFIG.shortButtonText}]\\s*`), '');
            return pair || '未知交易对';
        }
        return '未知交易对';
    }
    
    // 执行开多仓操作（带重试）
    async function openLongPosition() {
        let retryCount = 0;
        
        while (retryCount < CONFIG.longMaxRetries) {
            console.log(`开始执行开多仓操作... ${retryCount > 0 ? `(第${retryCount + 1}次重试)` : ''}`);
            
            if (!clickLongButton()) {
                console.log('未找到开多仓按钮');
                retryCount++;
                if (retryCount < CONFIG.longMaxRetries) {
                    console.log(`${CONFIG.waitBeforeRetry/1000}秒后重试开多仓...`);
                    await sleep(CONFIG.waitBeforeRetry);
                }
                continue;
            }

            await sleep(CONFIG.uiUpdateDelay);
            
            if (!clickSubmitButton()) {
                console.log('开多仓提交失败');
                retryCount++;
                if (retryCount < CONFIG.longMaxRetries) {
                    console.log(`${CONFIG.waitBeforeRetry/1000}秒后重试开多仓...`);
                    await sleep(CONFIG.waitBeforeRetry);
                }
                continue;
            }
            
            console.log('开多仓操作完成');
            return true;
        }
        
        console.log(`开多仓操作失败，已达到最大重试次数${CONFIG.longMaxRetries}次`);
        return false;
    }
    
    // 执行开空仓操作（带重试）
    async function openShortPosition() {
        let retryCount = 0;
        
        while (retryCount < CONFIG.shortMaxRetries) {
            console.log(`开始执行开空仓操作... ${retryCount > 0 ? `(第${retryCount + 1}次重试)` : ''}`);
            
            if (!clickShortButton()) {
                console.log('未找到开空仓按钮');
                retryCount++;
                if (retryCount < CONFIG.shortMaxRetries) {
                    console.log(`${CONFIG.waitBeforeRetry/1000}秒后重试开空仓...`);
                    await sleep(CONFIG.waitBeforeRetry);
                }
                continue;
            }

            await sleep(CONFIG.uiUpdateDelay);
            
            if (!clickSubmitButton()) {
                console.log('开空仓提交失败');
                retryCount++;
                if (retryCount < CONFIG.shortMaxRetries) {
                    console.log(`${CONFIG.waitBeforeRetry/1000}秒后重试开空仓...`);
                    await sleep(CONFIG.waitBeforeRetry);
                }
                continue;
            }
            
            console.log('开空仓操作完成');
            return true;
        }
        
        console.log(`开空仓操作失败，已达到最大重试次数${CONFIG.shortMaxRetries}次`);
        return false;
    }
    
    async function mainLoop() {
        console.log('自动化交易脚本开始运行...');
        
        while (CONFIG.isRunning) {
            CONFIG.iteration++;
            
            const now = new Date();
            const nextMinute = new Date(now);
            nextMinute.setMinutes(nextMinute.getMinutes() + 1);
            nextMinute.setSeconds(0);
            nextMinute.setMilliseconds(0);
            
            const waitTime = nextMinute.getTime() - now.getTime();
            
            if (waitTime > 0) {
                console.log(`[${formatTime(now)}] 等待整点开多仓，剩余 ${Math.round(waitTime/1000)} 秒`);
                await sleep(waitTime);
            }
            
            const exactTime = new Date();
            const currentTime = formatTime(exactTime);
            const tradingPair = getTradingPair();
            
            console.log(`[${currentTime}] 第${CONFIG.iteration}次执行 - 开多仓 ${tradingPair}`);
            
            const longSuccess = await openLongPosition();
            
            if (longSuccess) {
                console.log(`[${currentTime}] 开多仓成功`);
            } else {
                console.log(`[${currentTime}] 开多仓失败，继续执行休眠流程`);
            }
            
            console.log(`[${currentTime}] 开始休眠${CONFIG.sleepAfterLong/1000}秒...`);
            await sleep(CONFIG.sleepAfterLong);
            
            const afterSleep = new Date();
            console.log(`[${formatTime(afterSleep)}] 休眠结束，准备开空仓`);
            
            const shortSuccess = await openShortPosition();
            
            if (shortSuccess) {
                console.log(`[${formatTime(afterSleep)}] 开空仓成功`);
            } else {
                console.log(`[${formatTime(afterSleep)}] 开空仓失败，继续下一轮循环`);
            }
        }
    }
    
    // 启动脚本
    mainLoop().catch(error => {
        console.error('脚本运行出错:', error);
    });
    
    // 提供停止方法
    window.stopTrading = function() {
        CONFIG.isRunning = false;
        console.log('交易脚本已停止');
    };
    
    // 提供状态查询方法
    window.getTradingStatus = function() {
        return {
            isRunning: CONFIG.isRunning,
            iteration: CONFIG.iteration,
            tradingPair: getTradingPair(),
            config: {...CONFIG} // 返回配置副本
        };
    };
    
    console.log('自动化交易脚本已启动');
    console.log('执行逻辑：每分钟整点开多仓 → 休眠100秒 → 开空仓');
    console.log('当前交易对:', getTradingPair());
    console.log('如需停止，请在控制台输入: stopTrading()');
    console.log('查询状态输入: getTradingStatus()');
})();