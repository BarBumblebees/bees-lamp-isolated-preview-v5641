#!/usr/bin/env python3
"""Independent connections, no credentials other than disposable service."""
import os, subprocess, time, json, uuid
from pathlib import Path
BASE=['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def run(sql):
    return subprocess.run(BASE,input=sql,text=True,capture_output=True,check=True,timeout=20).stdout.strip()
def u(n):return str(uuid.UUID(int=n))
actor,session,store,member,card=[u(i) for i in (1,2,3,4,5)]
token='A'*43
claims=json.dumps({'sub':actor,'role':'authenticated','session_id':session})
auth=f"SELECT set_config('request.jwt.claims','{claims}',true); SET LOCAL ROLE authenticated;"
def as_staff(sql):return run("BEGIN;"+auth+sql+";COMMIT;").splitlines()[-1]
def reset():
    run(f"""TRUNCATE private.ml40_checkout_confirmations_v1,private.ml40_operation_receipts_v1,fixture.checkout_requests,fixture.point_transactions,private.ml40_balance_versions_v1;
    INSERT INTO fixture.point_transactions(member_id,kind,delta) VALUES('{member}','seed',100);""")
def confirm(scan=False):
    p=f"'{member}','{card}','{store}',100,0,100"
    rev=run(f"SELECT revision FROM private.ml40_balance_versions_v1 WHERE member_id='{member}'")
    fn="scan" if scan else "directory"
    tail=f",'{token}'" if scan else ""
    return json.loads(as_staff(f"SELECT public.ml40_api_{fn}_checkout_confirm_v1({p},'{rev}'{tail})"))['confirmation_id']
def commit(r,c,scan=False):
    fn="scan" if scan else "directory";tail=f",'{token}'" if scan else ""
    return f"SELECT public.ml40_api_{fn}_checkout_once_v1('{r}','{c}','{member}','{card}','{store}',100,0{tail})"
def legacy(r):
    return f"SELECT fixture.process_checkout_once_checked_v2('{r}','{member}','{store}',100,0,'{token}',NULL)"
# hold first connection open after actual operation; wait until second is actually blocked.
def race(first,second,second_error=None):
    env=dict(os.environ,PGAPPNAME='r37a-holder')
    a=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1,env=env)
    b=None
    try:
        a.stdin.write("BEGIN; SET LOCAL statement_timeout='15s';"+auth+first+";\n");a.stdin.flush()
        while True:
            line=a.stdout.readline()
            if not line:raise RuntimeError("first failed: "+a.stderr.read())
            if line.startswith('{') and '"status"' in line or line.startswith('{') and '"replayed"' in line:break
        first_result=json.loads(line)
        b=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,PGAPPNAME='r37a-waiter'))
        b.stdin.write("BEGIN; SET LOCAL statement_timeout='15s';"+auth+second+";COMMIT;\n");b.stdin.close();b.stdin=None
        deadline=time.monotonic()+8
        observed=False
        while time.monotonic()<deadline:
            if b.poll() is not None:break
            if run("SELECT count(*) FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='r37a-waiter' AND h.application_name='r37a-holder'")=='1':
                observed=True;break
            time.sleep(.1)
        if not observed:raise AssertionError("did not observe separate connection lock wait")
        a.stdin.write("COMMIT;\n");a.stdin.close();a.stdin=None
        _,ae=a.communicate(timeout=10)
        assert a.returncode==0,ae
        bo,be=b.communicate(timeout=10)
        if second_error:
            assert b.returncode!=0 and second_error in be,(bo,be)
            return first_result,None
        assert b.returncode==0,be
        return first_result,json.loads(bo.strip().splitlines()[-1])
    finally:
        for p in (a,b):
            if p is not None and p.poll() is None:p.kill();p.wait()
def counts(checkouts,receipts,balance):
    actual=run(f"SELECT (SELECT count(*) FROM fixture.checkout_requests)||','||(SELECT count(*) FROM private.ml40_operation_receipts_v1)||','||(SELECT sum(delta) FROM fixture.point_transactions WHERE member_id='{member}')")
    assert actual==f"{checkouts},{receipts},{balance}",actual
run(f"""INSERT INTO fixture.stores VALUES('{store}','Synthetic store',true,5);
INSERT INTO fixture.staff_profiles(id,role,default_store_id,active,display_name,encounter_points_enabled) VALUES('{actor}','store_admin','{store}',true,'Synthetic staff',true);
INSERT INTO auth.sessions VALUES('{session}','{actor}',now());
INSERT INTO fixture.directory_point_grants VALUES('{actor}','{store}');
INSERT INTO fixture.scope_grants VALUES('{actor}','{store}','checkout.execute',true);
INSERT INTO fixture.members(id,display_name) VALUES('{member}','Synthetic member');
INSERT INTO fixture.member_card_credentials(id,member_id,issued_store_id,token_hash,card_number,issued_at,issued_by) VALUES('{card}','{member}','{store}',extensions.digest('{token}','sha256'),900001,now(),'{actor}');
-- fixture-only direct legacy entry for test, matches old authenticated wrapper's privileges
GRANT USAGE ON SCHEMA fixture TO authenticated;
GRANT EXECUTE ON FUNCTION fixture.process_checkout_once_checked_v2(uuid,uuid,uuid,integer,integer,text,uuid) TO authenticated;""")
reset();c=confirm();r=u(101);a,b=race(commit(r,c),commit(r,c));assert a==b;counts(1,1,105);print('PASS same request concurrent replay; actual lock wait; exactly one checkout',flush=True)
reset();c1=confirm();c2=confirm();race(commit(u(102),c1),commit(u(103),c2),'40001');counts(1,1,105);print('PASS independent confirmations same balance; stale rejected',flush=True)
reset();c1=confirm();c2=confirm(True);race(commit(u(104),c1),commit(u(105),c2,True),'40001');counts(1,1,105);print('PASS directory versus scan; stale rejected',flush=True)
reset();c=confirm();race(legacy(u(106)),commit(u(106),c),'22023');counts(1,0,105);print('PASS legacy first same request collision rejected',flush=True)
reset();c=confirm();a,b=race(commit(u(107),c),legacy(u(107)));assert b['replayed'] is True;counts(1,1,105);print('PASS new first legacy replay; no duplicate',flush=True)
print('R37A_ALL_PASS 5/5',flush=True)
