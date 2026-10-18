"""Shared API integration checks; isolated SQLite test DB, never user data."""
import os
import tempfile
import subprocess
import sys
from pathlib import Path
from fastapi.testclient import TestClient

TEST_ROOT = Path(tempfile.mkdtemp(prefix='envia-tests-'))
os.environ['DATABASE_URL'] = 'sqlite:///' + str(TEST_ROOT / 'test.db')
os.environ['UPLOAD_DIR'] = str(TEST_ROOT / 'uploads')
from app import main as api

client = TestClient(api.app)

def auth(username, password):
    response = client.post('/api/v1/auth/login', json={'username':username,'password':password})
    assert response.status_code == 200
    return {'Authorization':'Bearer '+response.json()['token']}

def payload(**changes):
    return {'category':'waste','description':'Observation environnementale de test.', 'latitude':11.59,'longitude':43.14,'priority':'medium','source':'field','region':'Obock',**changes}

def test_web_and_mobile_share_events_and_dashboard():
    eco=auth('ecogarde','eco123'); expert=auth('expert','expert123')
    mobile=client.post('/api/v1/events',headers={**eco,'Idempotency-Key':'mobile-create-test'},json=payload())
    assert mobile.status_code==200
    event=mobile.json()
    assert event['history'][0]['status']=='pending'
    web_list=client.get('/api/v1/events',headers=expert).json()
    assert any(r['id']==event['id'] for r in web_list)
    before=client.get('/api/v1/statistics',headers=expert).json()
    web=client.post('/api/v1/events',headers={**eco,'Idempotency-Key':'web-create-normal'},json=payload(priority='normal'))
    assert web.status_code==200 and web.json()['priority']=='medium'
    mobile_list=client.get('/api/v1/events',headers=eco).json()
    assert any(r['id']==web.json()['id'] for r in mobile_list)
    after=client.get('/api/v1/statistics',headers=expert).json()
    assert after['total']==before['total']+1
    assert after['by_priority']['medium'] >= 2
    assert after['by_status']['pending'] >= 2

def test_retry_survives_new_session_and_media_retry():
    eco=auth('ecogarde','eco123')
    one=client.post('/api/v1/events',headers={**eco,'Idempotency-Key':'offline-stable'},json=payload()).json()
    eco=auth('ecogarde','eco123')
    retry=client.post('/api/v1/events',headers={**eco,'Idempotency-Key':'offline-stable'},json=payload())
    assert retry.json()['id']==one['id']
    conflicting=client.post('/api/v1/events',headers={**eco,'Idempotency-Key':'offline-stable'},json=payload(description='Un autre contenu environnemental.'))
    assert conflicting.status_code==409
    url=f"/api/v1/events/{one['id']}/media"
    args={'headers':{**eco,'Idempotency-Key':'same-photo'},'files':{'file':('photo.jpg',b'jpeg-test-content','image/jpeg')}}
    media=client.post(url,**args);again=client.post(url,**args)
    assert media.status_code==200 and media.json()['id']==again.json()['id']
    detail=client.get(f"/api/v1/events/{one['id']}",headers=eco).json()
    assert len(detail['media'])==1
    assert client.get(detail['media'][0]['url']).content==b'jpeg-test-content'

def test_real_status_history_and_permissions():
    eco=auth('ecogarde','eco123'); expert=auth('expert','expert123'); citizen=auth('citoyen','citoyen123')
    event=client.post('/api/v1/events',headers=eco,json=payload()).json()
    url=f"/api/v1/events/{event['id']}"
    assert client.patch(url,headers=eco,json={'status':'to_validate'}).status_code==403
    assert client.get(url,headers=citizen).status_code==403
    assert all(r['id']!=event['id'] for r in client.get('/api/v1/events',headers=citizen).json())
    assert client.patch(url,headers=expert,json={'status':'closed'}).status_code==400
    for status in ['to_validate','validated','processed','closed']:
        assert client.patch(url,headers=expert,json={'status':status}).status_code==200
    detail=client.get(url,headers=eco).json()
    assert [h['status'] for h in detail['history']]==['pending','to_validate','validated','processed','closed']
    assert client.post('/api/v1/events',headers=expert,json=payload()).status_code==403

def test_validation_and_logout():
    eco=auth('ecogarde','eco123')
    assert client.post('/api/v1/events',headers=eco,json=payload(latitude=100)).status_code==422
    assert client.post('/api/v1/events',headers=eco,json=payload(priority='bad')).status_code==400
    assert client.get('/api/v1/events').status_code==401
    assert client.post('/api/v1/auth/logout',headers=eco).status_code==200
    assert client.get('/api/v1/events',headers=eco).status_code==401

def test_idempotence_survives_process_restart_and_separates_users():
    eco=auth('ecogarde','eco123');citizen=auth('citoyen','citoyen123')
    key={'Idempotency-Key':'persistent-restart-key'}
    first=client.post('/api/v1/events',headers={**eco,**key},json=payload()).json()
    other=client.post('/api/v1/events',headers={**citizen,**key},json=payload()).json()
    assert first['id']!=other['id']
    script='''import json
from fastapi.testclient import TestClient
from app.main import app
c=TestClient(app)
token=c.post('/api/v1/auth/login',json={'username':'ecogarde','password':'eco123'}).json()['token']
r=c.post('/api/v1/events',headers={'Authorization':'Bearer '+token,'Idempotency-Key':'persistent-restart-key'},json={'category':'waste','description':'Observation environnementale de test.','latitude':11.59,'longitude':43.14,'priority':'medium','source':'field','region':'Obock'})
assert r.status_code==200
print(r.json()['id'])
'''
    result=subprocess.run([sys.executable,'-c',script],env=os.environ.copy(),capture_output=True,text=True,check=True)
    assert int(result.stdout.strip())==first['id']
