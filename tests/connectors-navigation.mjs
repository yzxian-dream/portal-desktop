// Exercise navigation with deliberately unresolved connector requests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const server=spawn(process.execPath,['tests/workspace-layout.mjs'],{env:{...process.env,PORTAL_LAYOUT_PREVIEW:'1',PORTAL_LAYOUT_PORT:'0'},stdio:['ignore','pipe','pipe']});
let browser;
try {
  const origin=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Preview startup timed out')),20000);
    let output='';
    server.stdout.on('data',data=>{output+=data;const match=output.match(/Layout preview: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    server.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Preview exited: ${code}`));});
  });
  browser=await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const page=await browser.newPage({viewport:{width:1280,height:860}});
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
  await page.goto(origin);
  await page.evaluate(()=>{
    const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
    const f=window.connectorFixture={details:{},catalog:deferred(),home:deferred(),tools:deferred(),oauth:deferred(),preview:deferred(),calls:{},opened:[]};
    const kits=['GitHub','Slack','API Only','Slow','Failure','Gmail'].map(name=>({release_id:name,name,icon_url:['GitHub','Slack','Gmail'].includes(name)?'https://home.beings.town/assets/connector-icons/'+name.toLowerCase()+'.svg':null,description:'Test app',availability:'listed',installation_ids:name==='GitHub'?['installed']:[]}));
    f.kits=kits;
    f.installed=[{id:'installed',root_release_id:'GitHub',status:'ready',desired_state:'enabled'}];
    const connectors={
      catalog:query=>query?.after ? Promise.resolve({enabled:true,items:f.kits.slice(4),next_after:null}) : f.catalog.promise.then(page=>({...page,items:f.kits.slice(0,4)})),
      installations:async after=>after ? {items:f.installed,next_after:null} : {items:[],next_after:'installed-page'},
      detail:id=>{f.calls[id]=(f.calls[id]||0)+1;return (f.details[id]??=deferred()).promise},
      tools:id=>{(f.toolRequests??=[]).push(id);if(f.switchTools){if(id==='gmail-install')return f.oldTools.promise;return Promise.resolve([{component_id:'second',connection_id:'second-account',export:'second_account_tool',enabled:true,read_only:true,available:true,account_authorized:true,revision:1}]);}return f.tools.promise;},
      setTool:async(_id,input)=>{f.updatedTool=input;return {...input,revision:2,read_only:true,available:true,account_authorized:true}},
      preview:async(id,input)=>{(f.previewRequests??=[]).push({id,input});return id==='API Only'?f.preview.promise:{id:id+'-enable',requires_adoption:false}},
      confirm:async id=>{
        (f.confirmIds??=[]).push(id);
        if(id==='Slack-enable'){f.oauthCalls=(f.oauthCalls||0)+1;return f.oauth.promise;}
        if(id==='Gmail-enable'){
          if(!f.gmailFailed){f.gmailFailed=true;throw Error('安装响应丢失');}
          return {id,release_id:'Gmail',status:'awaiting_account',installation_id:null,authorization_url:'https://example.com/gmail-oauth'};
        }
        f.confirmCalls=(f.confirmCalls||0)+1;f.kits=f.kits.map(kit=>kit.name==='API Only'?{...kit,installation_ids:['api-install']}:kit);f.installed.push({id:'api-install',root_release_id:'API Only',status:'ready',desired_state:'enabled'});return {id:'enable',status:'ready',installation_id:'api-install'};
      },
      advance:async id=>{(f.advanceIds??=[]).push(id);if(id==='Gmail-enable')return {id,release_id:'Gmail',status:f.gmailAuthorized?'preparing':'awaiting_account',installation_id:f.gmailAuthorized?'gmail-install':null};return {id,status:'preparing',release_id:'Slack',installation_id:'slack-install'}},
      state:async id=>{
        (f.stateIds??=[]).push(id);
        const name=id==='Gmail-enable'?'Gmail':'Slack',installation=name.toLowerCase()+'-install';
        f.kits=f.kits.map(kit=>kit.name===name?{...kit,installation_ids:name==='Gmail'?[installation,'gmail-second-install']:[installation]}:kit);
        if(!f.installed.some(item=>item.id===installation)) f.installed.push({id:installation,root_release_id:name,status:'ready',desired_state:'enabled'});
        if(name==='Gmail' && !f.installed.some(item=>item.id==='gmail-second-install'))f.installed.push({id:'gmail-second-install',root_release_id:'Gmail',status:'ready',desired_state:'enabled',revision:1});
        return {id,status:'ready',release_id:name,installation_id:installation};
      },
      lifecycle:async(id,action,revision,requestId)=>{
        f.lifecycle={id,action};(f.removals??=[]).push({id,action,revision,requestId});
        f.installed=f.installed.map(item=>item.id===id?{...item,desired_state:'removed',status:'removed'}:item);
        if(id==='gmail-second-install' && !f.removalFailed){f.removalFailed=true;throw Error('卸载响应丢失');}
      },
      syncOAuth:async()=>{throw Error('Unexpected legacy OAuth sync')},
      startOAuth:async()=>{throw Error('Unexpected authorization-only flow')},
      openAuthorization:async url=>{f.opened.push(url)},
    };
    window.fixtureApp.api.home={state:()=>f.home.promise,bounds:async()=>{},subscribe:()=>()=>{},connectors};
    window.fixtureApp.openClientSettings();
  });
  const settings=page.locator('#client-settings-dialog');
  await settings.getByRole('tab',{name:'应用',exact:true}).click();
  await settings.getByRole('status',{name:'正在加载应用…',exact:true}).waitFor();
  assert.equal(await settings.getByText('连接 Home 后管理应用',{exact:true}).count(),0,'Do not flash logged-out state while checking the session');
  await page.evaluate(()=>connectorFixture.home.resolve({authenticated:true}));
  await settings.locator('.connector-toolbar').waitFor();
  assert.equal(await settings.getByText('暂无可用应用。',{exact:true}).count(),0,'Do not flash empty state while catalog is loading');
  assert.equal(await settings.getByRole('status',{name:'正在加载应用…',exact:true}).count(),1);
  await page.evaluate(()=>connectorFixture.catalog.resolve({enabled:true,items:connectorFixture.kits.slice(0,4),next_after:'catalog-page'}));
  await settings.getByText('Failure',{exact:true}).waitFor();
  const card=name=>settings.locator('.connector-card').filter({hasText:name});
  await page.waitForFunction(()=>[...document.querySelectorAll('.connector-card-icon img')].length===3 && [...document.querySelectorAll('.connector-card-icon img')].every(img=>img.complete && img.naturalWidth>0));
  const resolveDetail=async(name,method='oauth2')=>page.evaluate(({name,method})=>connectorFixture.details[name].resolve({name,icon_url:'https://home.beings.town/assets/connector-icons/'+name.toLowerCase()+'.svg',accounts:[],methods:[{method,fields:[]}]}),{name,method});
  await card('GitHub').click();
  await settings.getByRole('heading',{name:'GitHub',exact:true}).waitFor();
  assert.equal(await card('Slack').count(),0,'Enter detail before the request completes');
  assert.equal(await settings.getByRole('status',{name:'正在加载…',exact:true}).count(),1);
  await resolveDetail('GitHub');
  await settings.getByRole('button',{name:'卸载',exact:true}).waitFor();
  assert(await settings.getByRole('button',{name:'卸载',exact:true}).isEnabled(),'Slow tools must not block detail actions');
  await page.waitForFunction(()=>{const img=document.querySelector('.connector-detail-heading img');return img?.complete && img.naturalWidth>0});
  await settings.locator('.connector-detail-heading img').dispatchEvent('error');
  await settings.locator('.connector-detail-heading .connector-line-icon').waitFor();
  await page.evaluate(()=>connectorFixture.tools.reject(new Error('工具加载失败')));
  await settings.getByRole('alert').filter({hasText:'工具加载失败'}).waitFor();
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('GitHub').click();
  await settings.getByRole('button',{name:'卸载',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>connectorFixture.calls.GitHub),1,'Reuse detail on re-entry');
  await page.evaluate(()=>connectorFixture.tools.promise=Promise.resolve(['read_repo','read_issues'].map(name=>({component_id:'shared',connection_id:'account',export:name,enabled:false,read_only:true,available:true,account_authorized:true,revision:1,contract_digest:'digest'}))));
  await settings.getByRole('button',{name:'刷新工具',exact:true}).click();
  await settings.getByRole('checkbox',{name:'read_repo',exact:true}).waitFor();
  await settings.getByRole('checkbox',{name:'read_repo',exact:true}).check();
  await page.waitForFunction(()=>connectorFixture.updatedTool);
  assert(await settings.getByRole('checkbox',{name:'read_repo',exact:true}).isChecked());
  assert.equal(await settings.getByRole('checkbox',{name:'read_issues',exact:true}).isChecked(),false,'Toggling one export must not overwrite another export in the same component');
  assert.equal(await settings.locator('.connector-tool').count(),2);
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('Slow').click();
  await settings.getByRole('heading',{name:'Slow',exact:true}).waitFor();
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('API Only').getByRole('button',{name:'连接',exact:true}).click();
  await card('API Only').getByRole('button',{name:'连接中…',exact:true}).waitFor();
  assert(await card('API Only').getByRole('button').isDisabled(),'Disable duplicate connections while resolving the auth method');
  assert.equal(await settings.getByRole('heading',{name:'API Only',exact:true}).count(),0,'Keep the catalog visible during connection preparation');
  await resolveDetail('Slow');
  assert.equal(await settings.getByRole('heading',{name:'Slow',exact:true}).count(),0,'Late response must not replace the selected page');
  await resolveDetail('API Only','api_key');
  await settings.getByRole('button',{name:/API Key/}).waitFor();
  assert.equal(await page.evaluate(()=>connectorFixture.oauthCalls||0),0,'Fallback must not attempt OAuth');
  await settings.getByRole('button',{name:/API Key/}).click();
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await page.evaluate(()=>connectorFixture.preview.resolve({id:'late-preview',requires_adoption:false}));
  await card('Slack').hover();
  await page.waitForFunction(()=>connectorFixture.details.Slack);
  await resolveDetail('Slack');
  assert.equal(await page.evaluate(()=>connectorFixture.confirmCalls||0),0,'Leaving the fallback page must not auto-confirm its late preview');
  const connect=card('Slack').getByRole('button',{name:'连接',exact:true});
  await connect.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>connectorFixture.oauthCalls===1);
  assert.equal(await page.evaluate(()=>connectorFixture.calls.Slack),2,'Connect must check current authorization');
  assert.equal(await page.evaluate(()=>connectorFixture.oauthCalls),1,'Keyboard connect must not bubble into detail navigation');
  await page.evaluate(()=>connectorFixture.oauth.resolve({id:'Slack-enable',status:'awaiting_account',installation_id:null,authorization_url:'https://example.com/oauth'}));
  await settings.getByRole('button',{name:'刷新连接状态',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>connectorFixture.opened),['https://example.com/oauth']);
  await settings.getByText('正在准备工具',{exact:true}).waitFor();
  assert.equal(await settings.getByText('应用已连接，工具已就绪。',{exact:true}).count(),0);
  await settings.getByText('应用已连接，工具已就绪。',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>connectorFixture.advanceIds),['Slack-enable']);
  assert.deepEqual(await page.evaluate(()=>connectorFixture.stateIds),['Slack-enable']);
  assert.deepEqual(await page.evaluate(()=>connectorFixture.opened),['https://example.com/oauth'],'Ready flows must not reopen the authorization URL');
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('Failure').getByRole('button',{name:'连接',exact:true}).click();
  await card('Failure').getByRole('button',{name:'连接中…',exact:true}).waitFor();
  await page.evaluate(()=>connectorFixture.details.Failure.reject(new Error('无法连接应用')));
  await settings.getByRole('alert').filter({hasText:'无法连接应用'}).waitFor();
  assert(await card('Failure').getByRole('button',{name:'连接',exact:true}).isEnabled(),'Failed connect restores the button for retry');
  await card('Failure').click();
  await page.evaluate(()=>connectorFixture.details.Failure.reject(new Error('连接请求超时')));
  await settings.getByRole('button',{name:'重试',exact:true}).waitFor();
  assert.equal(await settings.locator('.connector-loading-spinner').count(),0,'Stop spinning after a failed request');
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  await card('API Only').click();
  await settings.getByRole('button',{name:/API Key/}).click();
  await settings.getByRole('button',{name:'卸载',exact:true}).waitFor();
  await settings.getByRole('checkbox',{name:'read_repo',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>connectorFixture.confirmCalls),1,'A successful fallback connection refreshes the current installation and its tools');
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  // Even with an existing usable account, Connect launches OAuth; retries preserve the intent.
  await card('Gmail').hover();
  await page.waitForFunction(()=>connectorFixture.details.Gmail);
  await page.evaluate(()=>connectorFixture.details.Gmail.resolve({name:'Gmail',accounts:[{id:'gmail-account',display_name:'test@example.com',usable:true,installation_ids:['gmail-install']},{id:'second-account',display_name:'second@example.com',usable:true,installation_ids:['gmail-second-install']}],methods:[{method:'oauth2',fields:[]}]}));
  await card('Gmail').getByRole('button',{name:'连接',exact:true}).click();
  await settings.getByRole('alert').filter({hasText:'安装响应丢失'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>connectorFixture.previewRequests.filter(r=>r.id==='Gmail')),[{id:'Gmail',input:{method:'oauth2'}}]);
  await settings.getByRole('button',{name:'连接',exact:true}).click();
  await page.waitForFunction(()=>connectorFixture.opened.length===2);
  assert.equal(await settings.getByRole('button',{name:'卸载',exact:true}).count(),0,'Authorization launch alone must not install the app');
  await page.evaluate(()=>{connectorFixture.gmailAuthorized=true;window.dispatchEvent(new Event('focus'));});
  await settings.getByRole('button',{name:'卸载',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>connectorFixture.confirmIds.filter(id=>id==='Gmail-enable')),['Gmail-enable','Gmail-enable']);
  assert.equal(await page.evaluate(()=>connectorFixture.opened.length),2);
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  const added=settings.locator('.connector-group').filter({has:page.getByRole('heading',{name:/已添加/})});
  await added.locator('.connector-card').filter({hasText:'Gmail'}).waitFor();
  await card('Gmail').click();
  await settings.getByRole('button',{name:'卸载',exact:true}).waitFor();
  assert.equal(await settings.getByRole('heading',{name:'连接应用',exact:true}).count(),0);
  assert.equal(await settings.getByRole('button',{name:/^(暂停|恢复)$/}).count(),0);
  await page.evaluate(()=>{let resolve;const promise=new Promise(r=>resolve=r);connectorFixture.oldTools={promise,resolve};connectorFixture.switchTools=true;});
  await settings.getByRole('button',{name:/test@example.com/}).click();
  await settings.getByRole('button',{name:/second@example.com/}).click();
  await settings.getByRole('checkbox',{name:'second_account_tool',exact:true}).waitFor();
  await page.evaluate(()=>connectorFixture.oldTools.resolve([{component_id:'old',connection_id:'gmail-account',export:'late_old_tool',enabled:true,available:true}]));
  assert.equal(await settings.getByRole('checkbox',{name:'late_old_tool'}).count(),0);
  await page.evaluate(()=>{connectorFixture.gmailAuthorized=false;connectorFixture.switchTools=false;});
  await settings.getByRole('button',{name:'＋ 添加其他账号',exact:true}).click();
  await page.waitForFunction(()=>connectorFixture.opened.length===3);
  assert.equal(await settings.locator('.connector-account-row').count(),2,'Adding another account preserves existing accounts');
  assert.equal(await page.evaluate(()=>connectorFixture.installed.filter(i=>i.root_release_id==='Gmail' && i.desired_state!=='removed').length),2);
  page.once('dialog',dialog=>dialog.accept());
  await settings.getByRole('button',{name:'卸载',exact:true}).click();
  await settings.getByRole('alert').filter({hasText:'卸载尚未全部确认'}).waitFor();
  assert.equal(await settings.getByRole('button',{name:'连接',exact:true}).count(),0);
  await settings.getByRole('button',{name:'卸载',exact:true}).click();
  await settings.getByRole('button',{name:'连接',exact:true}).waitFor();
  const removals=await page.evaluate(()=>connectorFixture.removals);
  assert.deepEqual(removals.map(item=>item.id),['gmail-install','gmail-second-install','gmail-second-install']);
  assert.equal(removals[1].requestId,removals[2].requestId);
  assert.match(removals[1].requestId,/^[a-f0-9-]{36}$/);
  assert.equal(await page.evaluate(()=>connectorFixture.installed.find(item=>item.id==='installed').desired_state),'enabled');
  assert.equal(await settings.locator('.connector-account').count(),0);
  await page.evaluate(()=>{connectorFixture.gmailAuthorized=false;});
  await settings.getByRole('button',{name:'连接',exact:true}).click();
  await page.waitForFunction(()=>connectorFixture.opened.length===4);
  assert.deepEqual(await page.evaluate(()=>connectorFixture.previewRequests.filter(r=>r.id==='Gmail').map(r=>r.input)),[{method:'oauth2'},{method:'oauth2'},{method:'oauth2'}]);
  assert.equal(await settings.locator('.connector-account').count(),0,'Uninstalled app stays disconnected until the new authorization completes');
  await settings.getByRole('button',{name:'← 返回应用',exact:true}).click();
  assert.equal(await added.locator('.connector-card').filter({hasText:'Gmail'}).count(),0);
  await page.evaluate(()=>{
    let resolve,reject;
    const promise=new Promise((a,b)=>{resolve=a;reject=b});
    connectorFixture.catalog={promise,resolve,reject};
  });
  await settings.getByRole('button',{name:'刷新',exact:true}).click();
  await settings.getByRole('status',{name:'正在加载应用…',exact:true}).waitFor();
  assert.equal(await card('Slack').count(),1,'Retain existing cards during catalog refresh');
  await page.evaluate(()=>connectorFixture.catalog.reject(new Error('目录加载失败')));
  await settings.getByRole('alert').filter({hasText:'目录加载失败'}).waitFor();
  assert(await settings.getByRole('button',{name:'刷新',exact:true}).isEnabled(),'Catalog failure permits retry');
  assert.equal(await settings.getByRole('status',{name:'正在加载应用…',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: paginated catalog/installations, independent tool exports, late fallback preview, automatic coordinated installation, fresh OAuth after uninstall despite existing authorization, stable confirm retry, uninstall refresh and ready-state handling; session/catalog loading, inline connect loading and error recovery, immediate detail navigation, independent tool errors, cached detail reads, stale navigation protection, OAuth priority/fallback and keyboard connect.');
} finally {await browser?.close();server.kill();}
