(function() {
    'use strict';
    
    // ==================== 配置参数 ====================
    // 脚本控制
    let isRunning = true;
    let iteration = 0;
    let currentPosition = null; // 'long' | 'short' | null

    // 交易策略配置
    const config = {
        // 重试设置
        maxRetries: 99,
        retryDelay: 1000, // 重试延迟(毫秒)
        
        // 时间控制
        sleepDuration: 6500000, // 开多仓后休眠时间(毫秒)，默认100秒
        executionInterval: 60000, // 执行间隔(毫秒)，默认每分钟
        
        // 交易对设置
        longButtonText: '买入 / 做多',
        shortButtonText: '卖出 / 做空',
        submitButtonText: '下达市场订单',
        
        // 按钮样式类
        buttonClass: 'text-gray-0',
        longSubmitClass: 'border-green-8',
        shortSubmitClass: 'border-red-5',
        
        // UI交互延迟
        clickDelay: 500, // 点击后等待UI更新的时间(毫秒)
        
        // 安全限制
        maxIterations: 10000, // 最大迭代次数，防止无限循环
        enableSafetyChecks: true // 启用安全检测
    };

    // ==================== 工具函数 ====================
    function formatTime(date) {
        return date.toTimeString().split(' ')[0];
    }
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 查找按钮函数
    function findButton(text, className) {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(btn => 
            btn.textContent.includes(text) && 
            (!className || btn.className.includes(className))
        );
    }

    // ==================== 交易功能 ====================
    // 开多仓
    async function openLongPosition() {
        console.log('尝试开多仓...');
        
        // 点击做多按钮
        const longBtn = findButton(config.longButtonText, config.buttonClass);
        if (!longBtn) {
            throw new Error('未找到做多按钮');
        }
        longBtn.click();

        // 短暂等待确保UI更新
        await sleep(config.clickDelay);

        // 点击提交按钮
        const submitBtn = findButton(config.submitButtonText, config.longSubmitClass);
        if (!submitBtn) {
            throw new Error('未找到做多提交按钮');
        }
        
        if (submitBtn.disabled) {
            throw new Error('做多提交按钮不可用');
        }

        submitBtn.click();
        
        console.log('开多仓成功');
        return true;
    }

    // 开空仓
    async function openShortPosition() {
        console.log('尝试开空仓...');
        
        // 点击做空按钮
        const shortBtn = findButton(config.shortButtonText, config.buttonClass);
        if (!shortBtn) {
            throw new Error('未找到做空按钮');
        }
        shortBtn.click();

        // 短暂等待确保UI更新
        await sleep(config.clickDelay);

        // 点击提交按钮
        const submitBtn = findButton(config.submitButtonText, config.shortSubmitClass);
        if (!submitBtn) {
            throw new Error('未找到做空提交按钮');
        }
        
        if (submitBtn.disabled) {
            throw new Error('做空提交按钮不可用');
        }

        submitBtn.click();
        
        console.log('开空仓成功');
        return true;
    }

    // 带重试的开仓函数
    async function openPositionWithRetry(positionType) {
        const openFunction = positionType === 'long' ? openLongPosition : openShortPosition;
        let lastError = null;

        for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
            try {
                await openFunction();
                currentPosition = positionType;
                return true;
            } catch (error) {
                lastError = error;
                console.error(`第${attempt}次开${positionType === 'long' ? '多' : '空'}仓失败:`, error.message);
                
                if (attempt < config.maxRetries) {
                    console.log(`等待${config.retryDelay/1000}秒后重试...`);
                    await sleep(config.retryDelay);
                }
            }
        }

        console.error(`开${positionType === 'long' ? '多' : '空'}仓失败，已达到最大重试次数`);
        throw lastError;
    }

    // ==================== 主逻辑 ====================
    async function executeTradingCycle() {
        iteration++;
        const now = new Date();
        const currentTime = formatTime(now);

        // 安全检查
        if (config.enableSafetyChecks && iteration > config.maxIterations) {
            console.error(`达到最大迭代次数 ${config.maxIterations}，停止脚本`);
            isRunning = false;
            return;
        }

        try {
            // 整点开多仓
            console.log(`[${currentTime}] 第${iteration}次执行 - 开多仓`);
            await openPositionWithRetry('long');
            
            // 休眠
            console.log(`[${currentTime}] 开多仓成功，开始休眠${config.sleepDuration/1000}秒...`);
            await sleep(config.sleepDuration);
            console.log(`[${formatTime(new Date())}] 休眠结束`);

            // 休眠结束后开空仓
            console.log(`[${formatTime(new Date())}] 开空仓`);
            await openPositionWithRetry('short');

        } catch (error) {
            console.error(`[${currentTime}] 交易周期执行失败:`, error);
            // 即使失败也继续下一轮
        }
    }

    async function mainLoop() {
        console.log('反向交易脚本开始运行...');
        console.log('新策略: 整点开多仓 → 休眠 → 开空仓');
        console.log('配置参数:', config);
        
        while (isRunning) {
            const now = new Date();
            
            // 计算到下一分钟00秒需要等待的时间
            const nextMinute = new Date(now);
            nextMinute.setMinutes(nextMinute.getMinutes() + 1);
            nextMinute.setSeconds(0);
            nextMinute.setMilliseconds(0);
            
            const waitTime = nextMinute.getTime() - Date.now();
            
            if (waitTime > 0) {
                console.log(`[${formatTime(now)}] 等待下一分钟整点，剩余 ${Math.round(waitTime/1000)} 秒`);
                await sleep(waitTime);
            }
            
            // 执行交易周期
            await executeTradingCycle();
        }
    }
    
    // ==================== 启动与控制 ====================
    // 启动脚本
    mainLoop().catch(error => {
        console.error('脚本运行出错:', error);
    });
    
    // 提供控制方法
    window.stopReverseTrading = function() {
        isRunning = false;
        currentPosition = null;
        console.log('反向交易脚本已停止');
    };
    
    window.getReverseTradingStatus = function() {
        return {
            isRunning,
            iteration,
            currentPosition,
            config
        };
    };

    // 更新配置方法
    window.updateTradingConfig = function(newConfig) {
        Object.assign(config, newConfig);
        console.log('配置已更新:', config);
    };
    
    console.log('反向自动交易脚本已启动');
    console.log('新策略: 每分钟整点开多仓，休眠后开空仓');
    console.log('控制命令:');
    console.log('  - stopReverseTrading(): 停止脚本');
    console.log('  - getReverseTradingStatus(): 获取当前状态');
    console.log('  - updateTradingConfig({}): 更新配置');
})();