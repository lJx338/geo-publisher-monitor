const platforms = [
  ['baijia','百家号','百'],['toutiao','头条号','头'],['zhihu','知乎','知'],
  ['penguin','企鹅号','企'],['sohu','搜狐号','搜'],['netease','网易号','网'],
];
let state = null;
const $ = (id) => document.getElementById(id);
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '--';
const labels = {success:'正常',warning:'警告',failed:'失败',skipped:'跳过',uncertain:'待核对'};

function render(next) {
  state = next;
  $('version').textContent = `v${next.version}`;
  const publisher = $('publisher-status');
  publisher.textContent = next.publisher.message;
  publisher.className = `status-pill ${next.publisher.connected ? next.publisher.busy ? 'warning' : 'success' : 'error'}`;
  $('running-state').textContent = next.running ? '运行中' : '空闲';
  $('current-task').textContent = next.currentTask || '没有正在执行的任务';
  $('next-run').textContent = formatTime(next.nextPatrolAt);
  $('publish-state').textContent = next.settings.autoPublishEnabled ? '已启用' : '未启用';
  $('latest-result').textContent = next.latestRun ? ({success:'全部正常',partial:'部分异常',failed:'巡检失败',skipped:'任务跳过'}[next.latestRun.status] || next.latestRun.status) : '尚无记录';
  $('latest-time').textContent = next.latestRun ? formatTime(next.latestRun.finishedAt) : '--';
  $('progress-note').textContent = next.running ? `正在执行：${next.currentTask}` : '';
  $('run-all').disabled = next.running;
  $('weekly-generate').disabled = next.running;
  $('weekly-preflight').disabled = next.running;
  $('weekly-publish').disabled = next.running || !next.settings.autoPublishEnabled;
  $('update-message').textContent = next.update.message;
  $('install-update').classList.toggle('hidden', !next.update.canRestart);
  $('platform-grid').innerHTML = platforms.map(([key,name,icon]) => {
    const result = next.platformResults[key];
    const status = result?.status || 'idle';
    const message = result?.message || '尚未执行巡检';
    return `<article class="platform-card ${status}">
      <div><div class="platform-head"><div class="platform-name"><span class="platform-icon">${icon}</span>${name}</div><span class="result-badge ${status}">${labels[status] || '等待'}</span></div>
      <p class="platform-message">${escapeHtml(message)}</p><div class="platform-meta">${result ? `${formatTime(result.finishedAt)} · ${Math.round(result.durationMs/1000)}秒${result.code ? ` · ${result.code}` : ''}` : '没有历史记录'}</div></div>
      <div class="platform-actions"><button class="text-button run-platform" data-platform="${key}">单独巡检</button>${result?.screenshotPath ? `<button class="text-button evidence" data-path="${escapeAttr(result.screenshotPath)}">查看截图</button>` : '<span></span>'}</div>
    </article>`;
  }).join('');
  document.querySelectorAll('.run-platform').forEach((button) => button.addEventListener('click', () => action(() => window.monitor.runPlatform(button.dataset.platform), `${button.closest('.platform-card').querySelector('.platform-name').textContent.trim()}巡检已启动`)));
  document.querySelectorAll('.evidence').forEach((button) => button.addEventListener('click', () => window.monitor.openEvidence(button.dataset.path)));
}

function escapeHtml(value){return String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function escapeAttr(value){return escapeHtml(value);}
function toast(message){const element=$('toast');element.textContent=message;element.classList.add('show');setTimeout(()=>element.classList.remove('show'),3500);}
async function action(callback, success){try{await callback();toast(success);render(await window.monitor.getState());}catch(error){toast(error?.message||String(error));}}

function openSettings(){
  const settings=state.settings;
  $('schedule-hours').value=settings.scheduleHours.join(',');
  $('open-at-login').checked=settings.openAtLogin;
  $('auto-publish').checked=settings.autoPublishEnabled;
  $('feishu-app-id').value=settings.feishuAppId;
  $('feishu-recipient').value=settings.feishuRecipient;
  $('feishu-app-secret').value='';
  $('feishu-app-secret').placeholder=settings.hasFeishuAppSecret?'已安全保存，留空保持原值':'请输入 App Secret';
  $('llm-base-url').value=settings.llmBaseUrl;
  $('llm-model').value=settings.llmModel;
  $('llm-api-key').value='';
  $('llm-api-key').placeholder=settings.hasLlmApiKey?'已安全保存，留空保持原值':'请输入 API Key';
  $('settings-dialog').showModal();
}

$('run-all').addEventListener('click',()=>action(()=>window.monitor.runPatrol(),'六平台巡检完成'));
$('weekly-generate').addEventListener('click',()=>action(()=>window.monitor.generateWeekly(),'本周六篇文章已生成'));
$('weekly-preflight').addEventListener('click',()=>action(()=>window.monitor.preflightWeekly(),'六平台预检完成'));
$('weekly-publish').addEventListener('click',()=>{if(confirm('这会在六个平台真实发布公开文章。确认本周文章和预检结果无误并继续吗？'))action(()=>window.monitor.publishWeekly(),'每周实发流程完成');});
$('settings-button').addEventListener('click',openSettings);$('open-settings').addEventListener('click',openSettings);
$('close-settings').addEventListener('click',()=>$('settings-dialog').close());$('cancel-settings').addEventListener('click',()=>$('settings-dialog').close());
$('test-feishu').addEventListener('click',()=>action(()=>window.monitor.testFeishu(),'飞书测试消息已发送'));
$('check-update').addEventListener('click',()=>action(()=>window.monitor.checkUpdate(),'更新检查完成'));
$('install-update').addEventListener('click',()=>window.monitor.installUpdate());
$('settings-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const hours=$('schedule-hours').value.split(',').map((v)=>Number(v.trim())).filter(Number.isInteger);
  await action(()=>window.monitor.saveSettings({scheduleHours:hours,autoPublishEnabled:$('auto-publish').checked,openAtLogin:$('open-at-login').checked,feishuAppId:$('feishu-app-id').value,feishuRecipient:$('feishu-recipient').value,feishuAppSecret:$('feishu-app-secret').value||undefined,llmBaseUrl:$('llm-base-url').value,llmModel:$('llm-model').value,llmApiKey:$('llm-api-key').value||undefined}),'设置已保存');
  $('settings-dialog').close();
});

window.monitor.onState(render);
window.monitor.getState().then(render).catch((error)=>toast(error.message));
