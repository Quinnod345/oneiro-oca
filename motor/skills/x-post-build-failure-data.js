import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-build-failure-data';

async function queryBuildFailures(limit = 5) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        id,
        skill_name,
        error_message,
        error_type,
        root_cause,
        stack_trace,
        context,
        resolution,
        created_at,
        metadata
      FROM build_history
      WHERE status = 'failed'
        AND (error_message IS NOT NULL OR root_cause IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  } catch (err) {
    // Try alternate table names
    try {
      const result = await client.query(`
        SELECT 
          id,
          skill_name,
          error_message,
          root_cause,
          context,
          created_at,
          metadata
        FROM build_failures
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
      return result.rows;
    } catch (err2) {
      console.error(`[${SKILL_NAME}] DB query failed:`, err2.message);
      return [];
    }
  } finally {
    client.release();
  }
}

async function queryBuildHistorianSkill() {
  // Try to get data from build_historian's stored records
  const client = await pool.connect();
  try {
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
        AND table_name ILIKE '%build%'
    `);
    
    const tableNames = tables.rows.map(r => r.table_name);
    console.log(`[${SKILL_NAME}] Available build tables:`, tableNames);
    
    for (const tableName of tableNames) {
      try {
        const cols = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = $1
        `, [tableName]);
        const colNames = cols.rows.map(r => r.column_name);
        
        const hasFailure = colNames.some(c => 
          c.includes('fail') || c.includes('error') || c.includes('status')
        );
        
        if (hasFailure) {
          const statusCol = colNames.find(c => c === 'status' || c === 'outcome');
          const errorCol = colNames.find(c => c.includes('error') || c.includes('message'));
          const rootCauseCol = colNames.find(c => c.includes('root') || c.includes('cause'));
          const timeCol = colNames.find(c => c.includes('created') || c.includes('time') || c.includes('at'));
          
          let query;
          if (statusCol) {
            query = `SELECT * FROM ${tableName} WHERE ${statusCol} ILIKE '%fail%' ORDER BY ${timeCol || 'id'} DESC LIMIT 5`;
          } else {
            query = `SELECT * FROM ${tableName} ORDER BY ${timeCol || 'id'} DESC LIMIT 5`;
          }
          
          const rows = await client.query(query);
          if (rows.rows.length > 0) {
            return { tableName, rows: rows.rows, columns: colNames };
          }
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  } finally {
    client.release();
  }
}

function extractRootCause(record) {
  if (record.root_cause) return record.root_cause;
  
  const error = record.error_message || record.error || record.message || '';
  const context = typeof record.context === 'object' 
    ? JSON.stringify(record.context) 
    : (record.context || '');
  const metadata = typeof record.metadata === 'object'
    ? JSON.stringify(record.metadata)
    : (record.metadata || '');
  
  // Extract meaningful root cause from error message
  if (error.includes('Cannot find module')) {
    const match = error.match(/Cannot find module '([^']+)'/);
    return match ? `Missing module: ${match[1]}` : 'Module resolution failure';
  }
  if (error.includes('SyntaxError')) {
    return 'Syntax error in generated code';
  }
  if (error.includes('TypeError')) {
    const match = error.match(/TypeError: (.+?)(\n|$)/);
    return match ? `Type error: ${match[1].trim()}` : 'Type mismatch';
  }
  if (error.includes('ENOENT')) {
    const match = error.match(/ENOENT[^']*'([^']+)'/);
    return match ? `File not found: ${match[1]}` : 'File system error';
  }
  if (error.includes('timeout') || error.includes('Timeout')) {
    return 'Build timeout exceeded';
  }
  if (error.includes('permission') || error.includes('EACCES')) {
    return 'Permission denied';
  }
  
  // Return first meaningful line of error
  const firstLine = error.split('\n')[0].trim();
  return firstLine.length > 10 ? firstLine.substring(0, 120) : 'Unknown failure';
}

function formatFailureForPost(record, index) {
  const skillName = record.skill_name || record.name || record.file || 'unknown skill';
  const rootCause = extractRootCause(record);
  const errorType = record.error_type || record.type || 'BuildError';
  const timestamp = record.created_at 
    ? new Date(record.created_at).toISOString().split('T')[0]
    : 'recent';
  
  const resolution = record.resolution || record.fix || null;
  
  let post = `Build failure #${index + 1} — ${timestamp}\n\n`;
  post += `Skill: ${skillName}\n`;
  post += `Error type: ${errorType}\n`;
  post += `Root cause: ${rootCause}\n`;
  
  if (resolution) {
    post += `Resolution: ${resolution.substring(0, 100)}\n`;
  }
  
  return post.trim();
}

function formatSummaryPost(failures) {
  const count = failures.length;
  const errorTypes = {};
  const rootCauses = [];
  
  failures.forEach(f => {
    const type = f.error_type || f.type || 'Unknown';
    errorTypes[type] = (errorTypes[type] || 0) + 1;
    rootCauses.push(extractRootCause(f));
  });
  
  const topType = Object.entries(errorTypes).sort((a, b) => b[1] - a[1])[0];
  
  let post = `OCA build failure data — last ${count} failures:\n\n`;
  
  if (topType) {
    post += `Most common error type: ${topType[0]} (${topType[1]}x)\n\n`;
  }
  
  post += `Root causes:\n`;
  rootCauses.slice(0, 3).forEach((cause, i) => {
    const truncated = cause.length > 80 ? cause.substring(0, 77) + '...' : cause;
    post += `${i + 1}. ${truncated}\n`;
  });
  
  post += `\nReal data from build historian. No vague references.`;
  
  return post.trim();
}

async function postToX(content) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));
    
    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));
    
    await motor.type(content);
    await new Promise(r => setTimeout(r, 1000));
    
    // Submit
    await motor.press('Return', ['command']);
    await new Promise(r => setTimeout(r, 2000));
    
    return { success: true, method: 'browser' };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Browser post failed:`, err.message);
    
    // Fallback: copy to clipboard
    await motor.copyToClipboard(content);
    return { success: false, method: 'clipboard', content };
  }
}

async function postBuildFailureData(options = {}) {
  const { limit = 5, postSummary = true, postIndividual = false } = options;
  
  emit('skill:start', { skill: SKILL_NAME, options });
  
  try {
    // Query build failures
    let failures = await queryBuildFailures(limit);
    
    if (failures.length === 0) {
      // Try broader search
      const historianData = await queryBuildHistorianSkill();
      if (historianData) {
        failures = historianData.rows;
        console.log(`[${SKILL_NAME}] Found ${failures.length} records in ${historianData.tableName}`);
      }
    }
    
    if (failures.length === 0) {
      const noDataPost = `OCA build historian query: no failure records found in DB.\n\nEither all builds succeeded recently, or failure logging needs to be verified.\n\nChecking build pipeline integrity next.`;
      
      await postToX(noDataPost);
      emit('skill:complete', { skill: SKILL_NAME, result: 'no_data' });
      return { success: true, failuresFound: 0, posted: noDataPost };
    }
    
    console.log(`[${SKILL_NAME}] Found ${failures.length} build failures`);
    
    const results = [];
    
    if (postSummary) {
      const summaryPost = formatSummaryPost(failures);
      console.log(`[${SKILL_NAME}] Posting summary:\n${summaryPost}`);
      
      const result = await postToX(summaryPost);
      results.push({ type: 'summary', ...result, content: summaryPost });
      
      await new Promise(r => setTimeout(r, 3000));
    }
    
    if (postIndividual) {
      for (let i = 0; i < Math.min(failures.length, 3); i++) {
        const individualPost = formatFailureForPost(failures[i], i);
        console.log(`[${SKILL_NAME}] Posting failure ${i + 1}:\n${individualPost}`);
        
        const result = await postToX(individualPost);
        results.push({ type: 'individual', index: i, ...result });
        
        await new Promise(r => setTimeout(r, 4000));
      }
    }
    
    emit('skill:complete', { skill: SKILL_NAME, failuresFound: failures.length, results });
    
    return {
      success: true,
      failuresFound: failures.length,
      failures: failures.map(f => ({
        skill: f.skill_name || f.name,
        rootCause: extractRootCause(f),
        errorType: f.error_type,
        timestamp: f.created_at
      })),
      results
    };
    
  } catch (err) {
    console.error(`[${SKILL_NAME}] Error:`, err);
    emit('skill:error', { skill: SKILL_NAME, error: err.message });
    throw err;
  }
}

async function postDeepDiveFailureData(options = {}) {
  const { skillFilter = null } = options;
  
  const client = await pool.connect();
  try {
    let query = `
      SELECT 
        bh.*,
        COUNT(*) OVER (PARTITION BY bh.skill_name) as failure_count_for_skill
      FROM build_history bh
      WHERE bh.status = 'failed'
    `;
    
    const params = [];
    if (skillFilter) {
      params.push(skillFilter);
      query += ` AND bh.skill_name = $${params.length}`;
    }
    
    query += ` ORDER BY bh.created_at DESC LIMIT 10`;
    
    const result = await client.query(query, params);
    const failures = result.rows;
    
    if (failures.length === 0) {
      return { success: true, message: 'No failures found for deep dive' };
    }
    
    // Group by skill
    const bySkill = {};
    failures.forEach(f => {
      const skill = f.skill_name || 'unknown';
      if (!bySkill[skill]) bySkill[skill] = [];
      bySkill[skill].push(f);
    });
    
    const topSkill = Object.entries(bySkill).sort((a, b) => b[1].length - a[1].length)[0];
    
    let deepDivePost = `Deep dive: ${topSkill[0]} — ${topSkill[1].length} failures\n\n`;
    
    const recentFailure = topSkill[1][0];
    deepDivePost += `Most recent: ${new Date(recentFailure.created_at).toISOString().split('T')[0]}\n`;
    deepDivePost += `Root cause: ${extractRootCause(recentFailure)}\n\n`;
    
    if (topSkill[1].length > 1) {
      const causes = topSkill[1].map(f => extractRootCause(f));
      const uniqueCauses = [...new Set(causes)];
      deepDivePost += `Unique root causes: ${uniqueCauses.length}\n`;
      deepDivePost += `Pattern: ${uniqueCauses.length === 1 ? 'Single recurring issue' : 'Multiple distinct failures'}`;
    }
    
    await postToX(deepDivePost);
    
    return { success: true, skill: topSkill[0], failureCount: topSkill[1].length };
    
  } catch (err) {
    console.error(`[${SKILL_NAME}] Deep dive error:`, err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

async function run(options = {}) {
  return postBuildFailureData(options);
}

export default {
  postBuildFailureData,
  postDeepDiveFailureData,
  run
};